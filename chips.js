/* ---------------------------------------------------------------------------
   Topic chips — shared by / and /embed, same file on both, like chat.js.

   A chip types its words into the ask box and presses the button. That is the
   whole implementation, and it is the reason chat.js needed no change for any
   of this: the question travels the path a typed question travels, so it gets
   the same history, the same gates, the same rendering and the same errors.

   LOAD THIS AFTER chat.js, on every page that uses it. requestSubmit() fires a
   real submit event and chat.js is what listens for it. If this runs first,
   the listener does not exist yet, the form submits for real, and the page
   navigates to ?q=… — a broken-looking reload instead of an answer.

   English only, on both pages, deliberately (2026-09-01). The chips used to
   carry Greek in data-el on the landing; /embed has no language swap at all,
   so a bilingual chip there would have sat inert with nothing to report it.
   One language on both surfaces is the version with no hidden state.

   The markup lives in each page rather than here, the same way the chat
   surface's markup does — English in the HTML means the words are readable
   with no JavaScript at all, and only the click needs this file.
   --------------------------------------------------------------------------- */

(function () {
  var chips = document.getElementById('chips');
  var form = document.getElementById('ask-form');
  var input = document.getElementById('q');
  if (!chips || !form || !input) return;

  chips.addEventListener('click', function (event) {
    var chip = event.target.closest('button');
    // input.disabled is chat.js saying it is busy. Matching its own guard here
    // means a chip pressed mid-answer does nothing, rather than queueing.
    if (!chip || input.disabled) return;
    input.value = chip.textContent.trim();
    form.requestSubmit();
  });

  /* While a question is in flight chat.js disables the input and the send
     button. The chips are ours, so they follow — otherwise they sit there
     looking pressable and do nothing, which reads as a broken button rather
     than a busy one, especially for the readers this whole surface is for.

     Watched rather than told: chat.js owns that state and this file does not
     touch it, so the input's disabled attribute IS the signal. */
  new MutationObserver(function () {
    var buttons = chips.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i += 1) buttons[i].disabled = input.disabled;
  }).observe(input, { attributes: true, attributeFilter: ['disabled'] });
}());
