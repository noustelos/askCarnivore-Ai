/* ---------------------------------------------------------------------------
   The YouTube Data API client. Small on purpose.

   Quota is the whole design constraint here (§14.10, brief §5). The daily
   allowance is 10,000 units and the three calls we make cost wildly different
   amounts:

     channels.list       1 unit    → run ONCE per creator, ever, then cached
     playlistItems.list  1 unit    → 50 videos per unit. This is the workhorse.
     search.list       100 units   → NOT USED. Deliberately absent.

   search.list is how you would find a channel by name, and it is both the
   expensive call and the ambiguous one — it returns *likely* channels. Every
   creator in curation.json carries a handle, so `forHandle` answers exactly and
   for one hundredth of the cost. If a future edit reaches for search.list,
   something upstream has gone wrong: get the handle instead.

   THE HARD RULE: nothing in this file may be called from a user request path
   (§14.13). The cron fills the grid; the ask-worker only ever reads KV.
   --------------------------------------------------------------------------- */

const API = 'https://www.googleapis.com/youtube/v3';

export class QuotaError extends Error {}

export function createClient(apiKey, { fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('YOUTUBE_API_KEY missing');
  let unitsUsed = 0;

  async function call(path, params, cost) {
    const url = new URL(`${API}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', apiKey);

    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    unitsUsed += cost;

    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      // 403 on this API is almost always quotaExceeded; surfacing it as its own
      // type lets the caller stop the scan and keep what it already has rather
      // than hammer a closed door for the remaining creators.
      if (response.status === 403 && /quota/i.test(body)) throw new QuotaError(body);
      throw new Error(`youtube ${path} ${response.status}: ${body}`);
    }
    return response.json();
  }

  return {
    get unitsUsed() {
      return unitsUsed;
    },

    /** @handle → { channel_id, title, uploads_playlist_id }. 1 unit. */
    async resolveHandle(handle) {
      const data = await call(
        'channels',
        { part: 'id,snippet,contentDetails', forHandle: String(handle).replace(/^@?/, '@') },
        1,
      );
      const channel = data?.items?.[0];
      if (!channel) return null;
      return {
        channel_id: channel.id,
        title: channel.snippet?.title ?? '',
        uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
      };
    },

    /**
     * Uploads playlist → video ids, newest first, stopping at `since`.
     *
     * playlistItems has no publishedAfter filter, but it returns newest-first,
     * so the incremental rule is "page until you cross the watermark, then
     * stop". That is what keeps a weekly scan at a handful of units instead of
     * re-reading a whole catalogue (brief §5).
     */
    async listUploads(playlistId, { since = null, maxVideos = Infinity, maxPages = 20 } = {}) {
      const ids = [];
      let pageToken;
      const pageBudget = Math.min(maxPages, Math.ceil(maxVideos / 50) || maxPages);

      for (let page = 0; page < pageBudget; page += 1) {
        const data = await call(
          'playlistItems',
          { part: 'contentDetails', playlistId, maxResults: 50, pageToken },
          1,
        );
        let crossedWatermark = false;

        for (const item of data?.items ?? []) {
          const publishedAt = item?.contentDetails?.videoPublishedAt;
          if (since && publishedAt && publishedAt <= since) {
            crossedWatermark = true;
            break;
          }
          if (item?.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
        }

        pageToken = data?.nextPageToken;
        if (crossedWatermark || !pageToken || ids.length >= maxVideos) break;
      }

      return ids.slice(0, maxVideos === Infinity ? undefined : maxVideos);
    },

    /** Video ids → the metadata the grid needs. 1 unit per 50 ids. */
    async listVideos(ids) {
      const out = [];
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const data = await call(
          'videos',
          { part: 'snippet,contentDetails,statistics,status', id: batch.join(',') },
          1,
        );
        for (const video of data?.items ?? []) {
          // Anything not publicly watchable has no business in the grid: we
          // would be handing someone a link that asks them to log in.
          if (video?.status?.privacyStatus !== 'public') continue;
          out.push({
            id: video.id,
            title: video.snippet?.title ?? '',
            description: video.snippet?.description ?? '',
            channel_id: video.snippet?.channelId ?? '',
            published_at: video.snippet?.publishedAt ?? null,
            duration_iso: video.contentDetails?.duration ?? 'PT0S',
            views: Number(video.statistics?.viewCount) || 0,
            lang: (video.snippet?.defaultAudioLanguage ?? video.snippet?.defaultLanguage ?? 'en')
              .slice(0, 2)
              .toLowerCase(),
          });
        }
      }
      return out;
    },

    /** Link-rot pass: which of these ids are still public? 1 unit per 50. */
    async filterAlive(ids) {
      const alive = new Set();
      for (let i = 0; i < ids.length; i += 50) {
        const data = await call('videos', { part: 'status', id: ids.slice(i, i + 50).join(',') }, 1);
        for (const video of data?.items ?? []) {
          if (video?.status?.privacyStatus === 'public') alive.add(video.id);
        }
      }
      return alive;
    },
  };
}
