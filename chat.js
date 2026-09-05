/* ---------------------------------------------------------------------------
   Chat client — shared by / and /embed, same file on both (§16: one bot).

   It renders what the worker returns and nothing more. It never composes an
   answer, never guesses a link, and builds every node with textContent — the
   copy it displays comes from a language model, so it is treated as text, not
   as markup.
   --------------------------------------------------------------------------- */

(() => {
  const root = document.getElementById('chat');
  if (!root) return;

  const thread = root.querySelector('#thread');
  const form = root.querySelector('#ask-form');
  const input = root.querySelector('#q');
  const send = root.querySelector('#send');

  /** The conversation IS the session state (spec §4) — held here, sent whole,
      stored nowhere. Reload and the bot has forgotten you. */
  const history = [];
  let busy = false;
  let warned = false;

  /* Everything the interface says, in both languages. The key is the language
     of the ANSWER (data.lang — the language the person asked in), decided per
     turn rather than per page: a Greek speaker on an English browser asking in
     Greek must not get a Greek answer with an English button under it. */
  const UI = {
    en: {
      register: {
        start: 'start here',
        deep: 'in depth',
        // `pending` says nothing: we have not judged that creator's level yet,
        // so the UI does not put words in our mouth (§14.11).
        pending: '',
      },
      deeper: 'Show me the deep dive',
      basics: 'Back to basics',
      inGreek: 'in Greek',
      inEnglish: 'in English',
    },
    el: {
      register: {
        start: 'για αρχή',
        deep: 'σε βάθος',
        pending: '',
      },
      deeper: 'Θέλω πιο αναλυτικά',
      basics: 'Πίσω στα βασικά',
      inGreek: 'στα ελληνικά',
      inEnglish: 'στα αγγλικά',
    },
  };

  const strings = (lang) => (lang === 'el' ? UI.el : UI.en);

  const ERRORS = {
    rate_limited: 'That is a lot of questions at once — give it a minute and ask again.',
    not_configured: 'The bot is not switched on yet. Nothing to answer with.',
    upstream_unavailable: 'Could not reach the model just now. Try again in a moment.',
    forbidden_origin: 'This page is not allowed to talk to the bot.',
    bad_request: 'That question did not come through. Try rephrasing it.',
    offline: 'No connection to the bot. Check your network and try again.',
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function scroll() {
    thread.scrollTop = thread.scrollHeight;
  }

  function addTurn(className) {
    const turn = el('div', `turn ${className}`);
    thread.append(turn);
    scroll();
    return turn;
  }

  function warnPlaceholder(status) {
    if (warned || status !== 'PLACEHOLDER') return;
    warned = true;
    const notice = el(
      'p',
      'notice',
      'Preview: the index still holds placeholder entries. The links below are ' +
        'not real sources — they exist to prove the request flow works.',
    );
    thread.prepend(notice);
  }

  function renderLink(link, t) {
    const item = document.createElement('li');
    const anchor = el('a', 'result');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    anchor.append(el('span', 'result__title', link.title));
    if (link.label) anchor.append(el('span', 'result__label', link.label));

    const meta = el('div', 'result__meta');
    meta.append(el('span', 'meta--creator', link.creator));

    const register = t.register[link.register];
    if (register) meta.append(el('span', 'meta--register', register));

    if (link.crossLang) {
      meta.append(el('span', 'tag--lang', link.lang === 'el' ? t.inGreek : t.inEnglish));
    }

    anchor.append(meta);
    item.append(anchor);
    return item;
  }

  /**
   * The register toggle (§14.4): the person picks the depth, not the model.
   *
   * Both lists arrived with the answer, so this swaps what is on screen and
   * touches the network never — a tap costs nothing and cannot fail halfway.
   * It REPLACES the list rather than appending: "more detail" means a different
   * shelf, not a longer one.
   */
  function addToggle(turn, list, data, t, remember) {
    const button = el('button', 'deeper', t.deeper);
    button.type = 'button';
    let deep = false;

    button.addEventListener('click', () => {
      deep = !deep;
      const links = deep ? data.deep_links : data.links;
      list.replaceChildren(...links.map((link) => renderLink(link, t)));
      button.textContent = deep ? t.basics : t.deeper;
      // Only once it has actually been on screen does it count as shown.
      if (deep) remember(data.deep_links.map((link) => link.id));
      list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    turn.append(button);
  }

  function renderAnswer(turn, data, remember) {
    const t = strings(data.lang);
    turn.replaceChildren();
    warnPlaceholder(data.meta?.index_status);

    if (data.copy) turn.append(el('p', 'turn__copy', data.copy));

    // ⚠ A creator miss says nothing HERE any more (05/09/2026). The worker now
    // writes that sentence itself, in place of the model's copy, and it is
    // rendered above as ordinary copy — see CREATOR_MISS_COPY in src/router.js.
    // A note here as well would print the same thing twice. `creator_scope`
    // stays in the response for diagnostics and for whatever the client may
    // want to do with a match later.

    if (data.links?.length) {
      const list = el('ul', 'results');
      for (const link of data.links) list.append(renderLink(link, t));
      turn.append(list);

      // No deep_links field means the worker judged the deep view to be the
      // same answer again, or empty. No button, and nothing said about it.
      if (data.deep_links?.length) addToggle(turn, list, data, t, remember);
    }

    // Honest unmatched: no source of ours, one real place to go next.
    if (data.fallback) {
      const anchor = el('a', 'fallback', data.fallback.label);
      anchor.href = data.fallback.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      turn.append(anchor);
    }

    scroll();
  }

  function fail(turn, code) {
    turn.classList.add('turn--error');
    turn.replaceChildren(el('p', 'turn__copy', ERRORS[code] ?? ERRORS.upstream_unavailable));
    scroll();
  }

  function setBusy(state) {
    busy = state;
    input.disabled = state;
    send.disabled = state;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || busy) return;

    document.body.classList.add('is-active');
    input.value = '';
    setBusy(true);

    addTurn('turn--you').append(el('p', 'turn__copy', question));
    history.push({ role: 'user', content: question });

    const answer = addTurn('turn--bot');
    const waiting = el('span', 'waiting');
    waiting.append(el('i'), el('i'), el('i'));
    answer.append(waiting);
    scroll();

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        fail(answer, data.error);
        history.pop(); // a failed turn is not part of the conversation
        return;
      }

      // What was SEEN, so "give me more" can move past it — the deep list is
      // added by the toggle if and when the person opens it, not because it
      // was delivered. Sending ids nobody looked at would teach the model to
      // skip them.
      const turnState = {
        role: 'assistant',
        content: data.copy || '(no answer)',
        shown: (data.links ?? []).map((link) => link.id),
      };
      renderAnswer(answer, data, (ids) => {
        turnState.shown = [...new Set([...turnState.shown, ...ids])];
      });
      history.push(turnState);
    } catch {
      fail(answer, 'offline');
      history.pop();
    } finally {
      setBusy(false);
      input.focus();
    }
  });
})();
