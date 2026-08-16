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

  const REGISTER = {
    start: 'start here',
    deep: 'in depth',
    // `pending` says nothing: we have not judged that creator's level yet, so
    // the UI does not put words in our mouth (§14.11).
    pending: '',
  };

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

  function renderLink(link) {
    const item = document.createElement('li');
    const anchor = el('a', 'result');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    anchor.append(el('span', 'result__title', link.title));
    if (link.label) anchor.append(el('span', 'result__label', link.label));

    const meta = el('div', 'result__meta');
    meta.append(el('span', null, link.creator));

    const register = REGISTER[link.register];
    if (register) meta.append(el('span', null, register));

    if (link.crossLang) {
      meta.append(el('span', 'tag--lang', link.lang === 'el' ? 'in Greek' : 'in English'));
    }

    anchor.append(meta);
    item.append(anchor);
    return item;
  }

  function renderAnswer(turn, data) {
    turn.replaceChildren();
    warnPlaceholder(data.meta?.index_status);

    if (data.copy) turn.append(el('p', 'turn__copy', data.copy));

    if (data.links?.length) {
      const list = el('ul', 'results');
      for (const link of data.links) list.append(renderLink(link));
      turn.append(list);
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

      renderAnswer(answer, data);
      history.push({
        role: 'assistant',
        content: data.copy || '(no answer)',
        // What was served, so "give me more" can move past it.
        shown: (data.links ?? []).map((link) => link.id),
      });
    } catch {
      fail(answer, 'offline');
      history.pop();
    } finally {
      setBusy(false);
      input.focus();
    }
  });
})();
