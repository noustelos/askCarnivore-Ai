# AskCarnivore AI

## Το οικοσύστημα

Δύο πόρτες, **ένα κοινό index από κάτω**. Ίδια δεδομένα, διαφορετικός τρόπος πρόσβασης.

| | **askcarnivore.com** (ενικός) | **askcarnivores.com** (πληθυντικός) |
|---|---|---|
| **Τι είναι** | Bot — καθαρός δρομολογητής (pure router) | Portal — ανθρώπινος κόμβος |
| **Πώς το χρησιμοποιείς** | το ρωτάς με λόγια | το ξεφυλλίζεις με το μάτι |
| **Επιστρέφει** | links σε πηγές του index | directory, testimonials, tools, προϊόντα |
| **Πρόσβαση** | χωρίς λογαριασμό, χωρίς app | ελεύθερη· λογαριασμοί μόνο αν/όταν χρειαστούν |
| **Εμπόριο** | **κανένα** | affiliate, προϊόντα, tools |
| **Στάδιο** | Under Construction — **live** | domain + κενό repo· χωρίς περιεχόμενο |

Το ζευγάρι ενικός/πληθυντικός λειτουργεί υπέρ μας: το `askcarnivore` ρωτάει *το πράγμα*
(τη μηχανή), το `askcarnivores` δείχνει *τους ανθρώπους*. Η διάκριση πρέπει να είναι
ρητή και συνεπής παντού — αλλιώς τα δύο domains θα μοιάζουν με typo το ένα του άλλου.

## Στοιχεία project

| | |
|---|---|
| **Domains** | `askcarnivore.com` (live) · `askcarnivores.com` (χωρίς περιεχόμενο ακόμα) — **και τα δύο αγορασμένα 13/08/2026**, στη Cloudflare, ίδια λήξη |
| **Repo — bot** | https://github.com/noustelos/askCarnivore-Ai (αυτό εδώ) |
| **Repo — portal** | https://github.com/noustelos/ask-CARNIVORES — public, **κενό**, default branch `main`, χωρίς τοπικό clone |
| **Local path** | `/Users/nikoskaradimas/Desktop/ASK CARNIVORE AI` (μόνο το bot) |

Δύο ξεχωριστά repos — σωστό: διαφορετικό stack και data siloing. **Καμία δουλειά του
portal δεν μπαίνει σε αυτό εδώ το repo.**

---

# ASKCARNIVORE — Concept Base (Modus Operandi) · v1

*Μία πηγή αλήθειας για το concept — όχι κώδικας, όχι τεχνική προδιαγραφή. Το «τι
χτίζουμε και γιατί». Τεχνικές λεπτομέρειες (stack, RAG, deployment) κλειδώνουν σε
ξεχωριστό spec αργότερα.*

## STATUS — Κλειδωμένα / Ανοιχτά

**🔒 Locked:**

- **Positioning:** switchboard της carnivore κοινότητας. Όχι «AI που εξηγεί», αλλά
  «η πόρτα που σε στέλνει στη σωστή πηγή».
- **Business model:** Μοντέλο Α — δωρεάν bot, όλο το χρήμα από το portal. Κανένα
  paywall πάνω στο verb.
- **Bot = καθαρός δρομολογητής (pure router).** Δείχνει links, δεν παράγει φυσιολογία.
- **KB = index (θέμα → πηγή),** όχι ανθρώπινη φυσιολογία.
- **Provider:** Mistral (EU, open-weight, GDPR-friendly, φθηνό, ελαφρύ moderation).
- **Framing rule:** «τι λέει η κοινότητα / αυτοί οι γιατροί» — θέσεις, όχι αποδεδειγμένες
  αλήθειες. Τίμια μεροληψία, δηλωμένη στο όνομα.
- **Όχι dual-answer.** Η μεροληψία είναι δηλωμένη· επιβολή ισορροπίας θα ήταν flattening.
  (Βλ. §8 για το residual.)
- **NotebookLM = build tool μόνο.** KB με δικά μας λόγια + link-out. Attribution ≠ license.

**◻ Open:**

- ~~Αγορά `askcarnivores.com`~~ ✅ αγοράστηκε 13/08/2026.
- Λίστα creators/γιατρών για το αρχικό index (ποιοι μπαίνουν στο v1).
- Σειρά/περιεχόμενο των portal tools (ποιο πρώτο).
- Outreach template για τα emails στους creators.

## 1. Positioning

Ο κόμβος όπου, αντί να ψάχνει κανείς στο Google «ποιο κανάλι έχει ο Ken Berry, τι βιβλία,
ποιο podcast», ρωτάει **μία φορά** και δρομολογείται στη σωστή πηγή. Το bot είναι η
φυσικής-γλώσσας πόρτα σε αυτόν τον κόμβο.

**Γιατί αυτό, όχι «καλύτερες απαντήσεις από ChatGPT»:**

- **Χτίζεται.** Το «ποιος είναι ποιος και πού τον βρίσκεις» είναι πεπερασμένο, σταθερό,
  επαληθεύσιμο. Το «να νικήσω το ChatGPT σε βιοχημεία» είναι ατέρμονο.
- **Ανθεκτικό.** Ένας κόμβος που *δείχνει* σε ειδικούς κουβαλάει λιγότερη ευθύνη από ένα
  AI που *είναι* η αυθεντία. Δεν αποφαινόμαστε — παραπέμπουμε.
- **Brand fit.** «Just Ask. No app. No sign-up.» → ρωτάς, δρομολογείσαι.

## 2. Αρχιτεκτονική — Δύο πόρτες, ένα index

Δύο domains, δύο λειτουργίες, **ένα κοινό index από κάτω.**

- **`askcarnivore.com` — Bot.** Το ρωτάς με λόγια. Καθαρός δρομολογητής.
- **`askcarnivores.com` — Portal.** Το ξεφυλλίζεις με το μάτι. Ανθρώπινος κόμβος.

**Αποκλειστικά στο portal:** εμπόριο (προϊόντα, affiliate) + tools. Το index μοιράζεται.
Το bot μένει καθαρό — καμία πώληση, μόνο δρομολόγηση.

## 3. Business Model — Μοντέλο Α

**Δωρεάν bot, subsidized από το portal.** Κανένα paywall, κανένα credit, κανένα sign-up
πάνω στο bot — προστατεύει το «Just Ask».

- **Bot income:** μόνο **buy-me-a-coffee**, διακριτικό — στο footer, μετά την απάντηση,
  ΠΟΤΕ μέσα στη ροή. Τη στιγμή που μπει ανάμεσα σε ερώτηση και απάντηση, έγινε paywall.
- **Portal income:** affiliate (βιβλία / Amazon), directory, tools. Εδώ ζει το ταμείο.
- Το affiliate ζει **μέσα στα tools** (shopping list με links, Get Started που προτείνει
  βιβλία) — όχι ξεχωριστή φάση.

## 4. Το Bot — Pure Router

**Δεν εξηγεί. Δείχνει.** Σε κάθε ερώτηση: map σε πηγή(ές) του index → επιστροφή links.

**Τι κάνει:**

- Εννοιολογικό/βαθύ («τι είναι το Randle cycle;») → ομιλίες/podcasts creators.
- Testimonial («εμπειρίες με carnivore για δερματικά») → podcasts (π.χ. Dave Mac),
  testimonials.
- Γρήγορο πρακτικό («keto flu τώρα») → δρομολογεί στα **portal tools** (Get Started,
  electrolytes), όχι σε 90λεπτο podcast.

**Τι ΔΕΝ κάνει:**

- Δεν παράγει φυσιολογία (μηδέν hallucination — δεν μπορεί να την πει λάθος αν δεν την λέει).
- Δεν δίνει προσωπική/ιατρική καθοδήγηση.
- Δεν πουλάει.

**Ιατρικό scope:** το bot δρομολογεί σε «τι είναι / τι λέει η κοινότητα». ΠΟΤΕ «κόψε τη
μετφορμίνη / δοσολόγησε ινσουλίνη». Το tell: αν για να απαντήσει σωστά χρειάζεται να ξέρει
τη *συγκεκριμένη ιατρική κατάσταση αυτού του ανθρώπου* (φάρμακα, διάγνωση, νούμερα) →
**redirect σε γιατρό**, όχι δρομολόγηση σε content σαν να είναι προσωπική συμβουλή.
Το bot ποτέ δεν αναφέρει πρώτο τη λέξη «φάρμακο/ινσουλίνη».

## 5. Το Portal — Ανθρώπινος κόμβος

- **Directory** γιατρών & influencers (κανάλια, podcasts, βιβλία, links).
- **Testimonials** (π.χ. μέσω link-out/embed σε Dave Mac — Zero Carb, ~2000 συνεντεύξεις).
- **Tools:** Get Started (7 μέρες), Electrolytes/βασικά, Printable Shopping List,
  Macro calculator. *Evergreen, shareable, δεν χρειάζονται authority για να δουλέψουν —
  ίσως ο πραγματικός μαγνήτης, όχι το SEO.*
- **Products / affiliate** (βιβλία, Amazon).
- **Community events.**

## 6. Το κοινό Index (KB)

**Δομή: θέμα → πηγή.** Όχι εγχειρίδιο φυσιολογίας. Πεπερασμένο, επαληθεύσιμο, συντηρήσιμο.

- Χτίζεται από **δημόσια YouTube playlists** των creators (με NotebookLM ή στο χέρι).
- **NotebookLM = μόνο build tool** — για να μάθουμε/εντοπίσουμε. Οι entries γράφονται με
  **δικά μας λόγια** (facts, όχι αντιγραφή) + **link-out** στην πηγή.
- **Attribution ≠ license:** ποτέ rehost transcripts ή ουσιαστικά κομμάτια. Στέλνουμε
  traffic στους creators, δεν εξορύσσουμε από αυτούς.
- **Link rot:** το index θέλει περιοδική συντήρηση (βίντεο κατεβαίνουν, κανάλια αλλάζουν).
  Δεν είναι «φτιάξ' το και ξέχνα το».

## 7. Τρία επίπεδα

- **Bot** = δρομολογεί σε βάθος (creators, ομιλίες, testimonials) + σε portal tools για
  γρήγορα πρακτικά.
- **Portal** = κρατάει το γρήγορο starter υλικό (tools) + το εμπόριο.
- **Creators** = το βάθος.

Το bot δεν μαθαίνει ποτέ φυσιολογία. Παραμένει πόρτα.

## 8. Framing Rule & Link-Label Discipline — η επιφάνεια ευθύνης

Το bot λέει ελάχιστα — αλλά αυτά τα ελάχιστα (**πώς ονομάζει το link**) είναι το μόνο
σημείο που κουβαλάει ευθύνη. Πειθαρχία εδώ, ακόμα κι όταν το bot σχεδόν σωπαίνει.

**Ο κανόνας:** «τι λέει η κοινότητα / αυτοί οι γιατροί» — θέσεις, όχι αποδεδειγμένες
αλήθειες. Κάνει δύο δουλειές μαζί: είναι ο accuracy disclaimer *και* αυτό που επιτρέπει
να λιστάρουμε **όλους** γενναιόδωρα χωρίς να εγγυόμαστε προσωπικά για κάθε ισχυρισμό.
Τους *παρουσιάζουμε*, δεν τους *υπογράφουμε*.

**Link labels — πάντα εμπειρία, ποτέ treatment claim:**

- ✅ «εμπειρίες ανθρώπων που δοκίμασαν carnivore για δερματικά»
- ❌ «πώς θεραπεύτηκε το έκζεμα»

**Το residual (χωρίς dual-answer):** το bot δεν *παρουσιάζει* τη mainstream άποψη, αλλά
ούτε *αρνείται ότι υπάρχει*. Διαφορά ανάμεσα σε «εδώ τι λένε αυτές οι φωνές, άκου κι
αποφάσισε» (τίμια μεροληψία — το θέλουμε) και «settled science, οι διαφωνούντες
πουλημένοι» (pamphlet — μας καίει).

## 9. Τεχνική βάση (light — πλήρες spec αργότερα)

- **Provider:** Mistral (Small/Flash tier αρκεί για Q&A routing).
- **Prompt caching:** το KB context είναι σταθερό → πληρώνεται μία φορά, όχι σε κάθε call.
  Κρίσιμο για κόστος.
- **Rate limit:** ΑΣΦΑΛΕΙΑ, όχι μονετοποίηση — να μη σε κάψει viral moment ή κακόβουλος
  στον λογαριασμό API.
- **Stack (υπάρχον):** Cloudflare Pages + worker-based flow (όπως AskSantorini).
  Data siloing: ξεχωριστό project.

## 10. Content Sourcing / Outreach

- **Email στους creators:** ζήτα τη *δική τους* λίστα θεμάτων από τα podcasts τους. Κάνει
  τρία μαζί: content-sourcing + χτίσιμο σχέσης + partnership on-ramp (blessing).
- **Μη εξαρτάσαι από τις απαντήσεις.** Το base index το χτίζεις μόνος από δημόσια
  playlists· οι λίστες τους είναι το μπόνους, όχι η προϋπόθεση.
- **Νομικά:** το link-out σε δημόσιο YouTube είναι ό,τι κάνει κάθε search engine — δεν
  χρειάζεται άδεια για να δείξεις. Την ευλογία τη θες για τη σχέση, όχι για τη νομιμότητα.
- **Σειρά:** live πρώτα, μετά τα emails. Live site μιλάει μόνο του· «θα φτιάξω» δεν πείθει.

## 11. v1 Scope (προστασία από overengineering)

**ΜΕΣΑ στο v1:**

- Bot ως pure router πάνω σε αρχικό index (ένα set creators/θεμάτων).
- Portal ως στατική σελίδα: directory + 2-3 tools + link-out testimonials.
- Framing rule + link-label discipline στο system prompt.
- Rate limit (safety).
- Buy-me-a-coffee (footer).

**ΕΚΤΟΣ v1 (αργότερα):**

- Πλήρες affiliate integration παντού.
- Community events μηχανισμός.
- Deep/βαθύ index — ξεκινάμε στενά, μεγαλώνει.
- Οποιοδήποτε credit/account/Stripe (δεν υπάρχει στο Μοντέλο Α — ποτέ).

## 12. Ανοιχτές αποφάσεις

- ~~Αγορά `askcarnivores.com` (πληθυντικός — portal)~~ ✅ έγινε 13/08/2026.
- Ποιοι creators/γιατροί στο v1 index.
- Ποιο tool πρώτο (πρόταση: Get Started 7 μερών — highest share value).
- Outreach email template.

*Τέλος v1. Επόμενο λογικό βήμα: κλείδωμα αρχικής λίστας creators για το index + τεχνικό
spec (RAG/router, Mistral integration, rate limit) — που χτίζεται πάνω σε αυτή την
κλειδωμένη λογική.*

---

# Υλοποίηση — `askcarnivore.com`

## Τρέχουσα κατάσταση

Στατική σελίδα "Coming Soon" στο [index.html](index.html). Χωρίς build step, χωρίς
dependencies, χωρίς external assets — όλα inline ώστε να ανεβαίνει όπως είναι.

**Περιεχόμενο σελίδας:** morphing mark → `Ask Carnivore Ai` → `No app. No sign-up. Just Ask.`
→ `Under Construction · Coming Soon`, και στο footer το studio credit.

### Studio credit (footer)

`A NOUSTELOS_STUDIO PROJECT />` με link στο https://noustelos.gr/.

Το **`/>` είναι το σήμα του studio, όχι στίξη** — μην το «διορθώσεις» ποτέ σε σκέτο
κείμενο και μην το αφαιρέσεις. Στο noustelos.gr έχει δικό του treatment, το οποίο
αντιγράφηκε εδώ αυτούσιο (`.footer-brand-mark`):

| Ιδιότητα | Τιμή | |
|---|---|---|
| `font-size` | `0.74em` | μικρότερο από τον wordmark |
| `font-weight` | `600` | ελαφρύτερο (ο wordmark είναι 700) |
| `letter-spacing` | `0.03em` | πιο σφιχτό από το `.07em` του wordmark |
| `transform` | `translateY(-0.32em)` | **σηκωμένο πάνω από τη γραμμή** |
| gap πριν το mark | `0.18em` | |

Δύο συνειδητές αποκλίσεις από το πρωτότυπο:

- **Χρώμα.** Το studio το βάφει `#6f665b` — πάνω στα σκούρα μας backgrounds θα
  εξαφανιζόταν. Κρατήθηκε ο *ρόλος* (πιο σβηστό από τον wordmark) με
  `hsl(20 18% 97% / .58)`, όχι η ακριβής τιμή.
- **Γραμματοσειρά.** Το studio χρησιμοποιεί Space Grotesk· εδώ μένει το system stack,
  γιατί ο κανόνας self-contained (χωρίς CDN/Google Fonts) βαραίνει περισσότερο σε ένα
  landing μιας σελίδας. Αν κάποτε μπει σωστή brand γραμματοσειρά, εδώ είναι το σημείο.

Το `/>` είναι `aria-hidden` — το accessible name του link μένει
«A NOUSTELOS_STUDIO PROJECT». Το footer είναι επίσης η θέση όπου θα μπει αργότερα το
buy-me-a-coffee (§3) — **ποτέ μέσα στη ροή ερώτησης/απάντησης.**

### Visual identity (landing)

Full-bleed background που κυλάει αργά ανάμεσα σε τρία χρώματα, με ένα λευκό σχήμα
στο κέντρο που «αναπνέει» και **αλλάζει μορφή: κύκλος → τρίγωνο → τετράγωνο → κύκλος.**

| Token | Τιμή | Ρόλος |
|---|---|---|
| `--c1` | `hsl(343 72% 34%)` | wine |
| `--c2` | `hsl(33 85% 32%)` | sear |
| `--c3` | `hsl(223 65% 34%)` | indigo |
| `--pulse-dur` | `2.7s` | μία «ανάσα» του mark |
| `--shift-dur` | `27s` | πλήρης κύκλος χρωμάτων |

Ο **κύκλος είναι η θέση ηρεμίας** — αυτό είναι το mark/favicon state. Το morph λέει
«μία πόρτα, πολλές μορφές απάντησης», δηλαδή το switchboard positioning (§1) σε κίνηση —
πιο κοντά στο concept από ό,τι ο χτύπος καρδιάς, που έλεγε απλώς «υγεία».

**Ρητά ΟΧΙ αναφορά σε PlayStation.** Το set △ ○ ✕ □ *μαζί, σε διάταξη χειριστηρίου*
είναι κατοχυρωμένο σήμα της Sony — και το gaming coding είναι off-brand για health.
Το «φιλικό» το φέρνει το `stroke-linejoin: round` και ο αργός ρυθμός, όχι η αναφορά.

**Πώς δουλεύει το morph** (λεπτομέρειες στα σχόλια του [index.html](index.html)):

- Και τα τρία σχήματα είναι **το ίδιο path**: 4 τμήματα cubic Bézier, ίδιο πλήθος και
  σειρά — γι' αυτό παρεμβάλλονται καθαρά. Ο κύκλος είναι 4 τόξα γυρισμένα 45° ώστε τα
  άγκιστρα να πέφτουν στις γωνίες του τετραγώνου· το τρίγωνο έχει ένα **εκφυλισμένο
  τμήμα** στην κορυφή (οι δύο πάνω γωνίες καταρρέουν σε ένα σημείο).
- **SMIL (`<animate>`), όχι CSS** — το `d` δεν είναι animatable CSS property στον Firefox.
- Οι συντεταγμένες είναι σχετικές ως προς το κέντρο, με `translate(60,60)` στο `<g>`:
  κάθε rotate/scale γίνεται γύρω από το `(0,0)`, χωρίς εξάρτηση από `transform-box`.
- **Περιστροφή σε γωνίες συμμετρίας:** `0° → 120°` (τρίγωνο, 3-fold) → `270°` (τετράγωνο,
  4-fold) → `390°`. Κανένα σχήμα δεν κάθεται στραβά, και στο 390° είμαστε ήδη κύκλος
  οπότε το loop πίσω στο 0° δεν φαίνεται.
- **Συγχρονισμός:** `10.8s` ο κύκλος σχημάτων (2.7s hold + 0.9s morph × 3), `2.7s` η
  ανάσα → **ακριβώς 4 ανάσες ανά γύρο**, ώστε οι δύο ρυθμοί να μην ξεφεύγουν.
- Το **echo** (αχνό ping προς τα έξω) τρέχει στον ρυθμό της ανάσας, όχι σε δικό του.

Η «ανάσα» κατάγεται από το
[Heartbeating Ring Preloader](https://codepen.io/jkantner/pen/RNKyWKd) του Jon Kantner.
Αλλαγές που έγιναν στην πορεία:

- SCSS → plain CSS (τα `#{}` interpolations λύθηκαν σε ποσοστά· χωρίς `sass` build).
- Το heartbeat έγινε ήρεμη ανάσα: `1s → 2.7s`, μικρότερο πλάτος, συμμετρικό easing
  (`.37 0 .63 1`) αντί για το snappy `ease-in`/`ease-out` ζευγάρι.
- Η ανάσα **μετακόμισε από το `r` του `<circle>` σε `scale` + `stroke-width`** — το `r`
  δεν υπάρχει σε `<path>`. Ίδιο πλάτος, ίδιο easing.
- Τα χρώματα βάθυναν από `90% 50%` ώστε το λευκό κείμενο να περνάει WCAG AA
  (8.5:1 / 5.6:1 / 9.8:1 αντί για ~2.3:1 στο αρχικό πορτοκαλί).
- `--shift-dur` `3s → 27s` — τα 3s ήταν στροβοσκόπιο.
- Προστέθηκαν: `prefers-reduced-motion`, vignette για βάθος, `100svh`,
  dark chip πίσω από το status ώστε να διαβάζεται σε κάθε φάση του κύκλου.

**Προσοχή:** το SMIL **δεν** ακούει το `animation: none` του `prefers-reduced-motion`.
Παγώνει ρητά με `pauseAnimations()` από ένα τρίγραμμο inline script στο τέλος του
document. Αν προστεθεί άλλο SMIL, θέλει και αυτό κάλυψη εκεί.

Η παλέτα του landing είναι κοινή και για τα δύο sites — να διαβάζονται ως αδέλφια.

## Deployment

**Live από 14/08/2026.** Cloudflare Pages, project `askcarnivore`, συνδεδεμένο στο
GitHub repo. Κάθε push στο `main` κάνει auto-deploy.

| | |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | *(κενό)* |
| Build output directory | `/` |
| Env vars | καμία |
| Pages URL | `askcarnivore.pages.dev` |
| Custom domains | `askcarnivore.com`, `www.askcarnivore.com` — και τα δύο Active με SSL |

DNS: δύο auto-created CNAMEs προς `askcarnivore.pages.dev`. Δεν έχει πειραχτεί
τίποτα άλλο στο zone.

**Προσοχή στο setup:** το τρέχον Cloudflare dashboard σπρώχνει ένα ενοποιημένο
"Create application" flow που κάνει deploy μέσω `npx wrangler deploy` — αυτό απαιτεί
`wrangler.toml`, που δεν έχουμε (και δεν χρειαζόμαστε για στατικό site). Το σωστό
μονοπάτι είναι το κλασικό Pages setup στο `/pages/new/provider/github`.

## Δομή

```
.
├── CLAUDE.md      # αυτό το αρχείο — concept, context & εκκρεμότητες
├── index.html     # landing page (Under Construction)
└── README.md
```

## Αρχές / κανόνες

- Η σελίδα να παραμείνει self-contained (inline CSS/JS, χωρίς CDN, χωρίς build step)
  όσο είμαστε σε landing φάση.
- Responsive & dark/light aware.
- Το περιεχόμενο για την carnivore διατροφή είναι **ενημερωτικό, όχι ιατρική συμβουλή** —
  θέλει disclaimer παντού όπου δίνονται πληροφορίες υγείας. Ο framing rule (§8) *είναι*
  ο accuracy disclaimer· το ιατρικό disclaimer μπαίνει επιπλέον, από το intro screen.
- **«No app. No sign-up. Just Ask.» = μόνο για το bot.** Να μην εμφανιστεί ποτέ στο
  `askcarnivores.com`.

---

## Pending / Εκκρεμότητες

### Bot (`askcarnivore.com`) — v1

- [ ] **Αρχική λίστα creators/γιατρών** για το index — μπλοκάρει το KB
- [ ] Χτίσιμο του index (θέμα → πηγή) από δημόσια playlists· entries με δικά μας λόγια
- [ ] System prompt: pure-router συμπεριφορά + framing rule + link-label discipline +
      ιατρικό redirect
- [ ] Mistral integration (Small/Flash), prompt caching για το σταθερό KB context
- [ ] Rate limit (safety, όχι μονετοποίηση)
- [ ] Chat UI πάνω στο υπάρχον landing· worker-based flow σε Cloudflare
- [ ] **Το morph να γίνει λειτουργικό σήμα** όταν ζήσει το bot: κύκλος σταθερός = idle
      / σε περιμένω· morph σε εξέλιξη = ψάχνω στο index· σταμάτημα στον κύκλο = έτοιμο.
      Τότε η κίνηση *σημαίνει* κάτι αντί να διακοσμεί, και το landing κρατάει ήδη το
      vocabulary του τελικού UI.
- [ ] Intro screen με disclaimer (πριν την πρώτη ερώτηση)
- [ ] Buy-me-a-coffee στο footer — **ποτέ** μέσα στη ροή ερώτησης/απάντησης
      (το footer υπάρχει ήδη, με το studio credit)
- [x] ~~Σύνδεση repo με Cloudflare Pages + custom domain `askcarnivore.com`~~ ✅ 14/08/2026

### Portal (`askcarnivores.com`) — v1, στατικό

- [x] ~~Αγορά domain~~ ✅ 13/08/2026
- [x] ~~Ξεχωριστό repo~~ ✅ 14/08/2026 — `noustelos/ask-CARNIVORES` (κενό)
- [ ] Cloudflare Pages project πάνω στο repo + custom domain `askcarnivores.com`
      (ίδιο μονοπάτι με το bot: `/pages/new/provider/github`, όχι το wrangler flow)
- [ ] Coming-soon landing μέχρι να υπάρξει περιεχόμενο — αδελφό του `askcarnivore.com`
      (ίδια παλέτα) αλλά **χωρίς** το «No app. No sign-up. Just Ask.»
- [ ] Directory γιατρών & influencers πάνω στο κοινό index
- [ ] 2-3 tools — πρόταση για πρώτο: **Get Started (7 μέρες)**
- [ ] Link-out testimonials (Dave Mac — Zero Carb)
- [ ] Intro screen με disclaimer

### Outreach

- [ ] Outreach email template προς creators (λίστα θεμάτων + σχέση + blessing)
- [ ] **Σειρά:** live πρώτα, emails μετά

### Γενικά / λοιπά

- [ ] **Canonical domain.** Το `www.askcarnivore.com` σερβίρει το ίδιο περιεχόμενο
      αντί να κάνει redirect στο apex — δύο hostnames με ίδιο content, το οποίο
      διασπά το SEO signal. Θέλει Bulk Redirect ή Redirect Rule: `www` → apex (301).
      Καλύτερα τώρα, πριν μαζέψει links.
- [ ] Συντήρηση index — link rot (περιοδικός έλεγχος)
- [ ] Legal: disclaimer, privacy policy, terms
- [ ] Λογότυπο / branding — υπάρχει παλέτα, λείπει mark & γραμματοσειρά
- [ ] Social links (X, Instagram, κλπ.) — δεν έχουν δοθεί ακόμα
- [ ] OG image (`og:image`) για σωστό preview σε social shares
- [ ] Να αποφασιστεί αν το indigo (`--c3`) μένει· wine + sear ταιριάζουν στο carnivore
      theme, το μπλε είναι το μόνο off-brand χρώμα της τριάδας

### Εκτός v1 — να μη σχεδιαστεί τώρα

- Πλήρες affiliate integration παντού
- Community events μηχανισμός
- Βαθύ index (ξεκινάμε στενά)
- Credits / accounts / Stripe — **ποτέ** στο Μοντέλο Α
- Δικό μας searchable αρχείο testimonials με μεταδεδομένα/ταξινόμηση: το v1 κάνει
  **link-out**, όχι δικό μας index βίντεο. Οτιδήποτε πέρα από link-out/embed θέλει
  πρώτα συνεννόηση με τον ιδιοκτήτη του καναλιού.

---

## Changelog

- **2026-08-14** — Αρχικό setup: CLAUDE.md + Under Construction landing page.
- **2026-08-14** — Landing ξαναχτίστηκε πάνω στο pulse-ring concept (βλ. Visual identity).
- **2026-08-14** — Live στο `askcarnivore.com` μέσω Cloudflare Pages.
- **2026-08-14** — Το `askcarnivores.com` απέκτησε ρόλο· το project έγινε δύο sites.
- **2026-08-14** — **Concept Base v1 κλείδωσε** (αντικαθιστά τις προηγούμενες
  κατευθύνσεις): switchboard positioning, bot = pure router, KB = index θέμα→πηγή
  (όχι φυσιολογία, όχι testimonials ως γνώση), Μοντέλο Α (δωρεάν bot / έσοδα από portal),
  Mistral, framing rule «τι λέει η κοινότητα». Το portal ξεπάγωσε και μπαίνει στο v1 ως
  στατική σελίδα. Τα testimonials μπαίνουν ως **link-out** στο κανάλι του Dave Mac.
- **2026-08-14** — Δημιουργήθηκε ξεχωριστό repo για το portal: `noustelos/ask-CARNIVORES`
  (κενό). Επιβεβαιώθηκε ότι και τα δύο domains αγοράστηκαν 13/08/2026.
- **2026-08-14** — Το pulse ring έγινε **morphing mark**: κύκλος → τρίγωνο → τετράγωνο →
  κύκλος, με την ανάσα να συνεχίζεται από κάτω και ένα αχνό echo. Το morph εκφράζει το
  switchboard positioning· ο κύκλος παραμένει η θέση ηρεμίας. Ρητά **χωρίς** αναφορά σε
  PlayStation (σήμα Sony + λάθος coding για health). Εκκρεμεί: να γίνει λειτουργικό
  σήμα idle/thinking όταν ζήσει το bot.
- **2026-08-14** — Προστέθηκε footer με το studio credit
  `A NOUSTELOS_STUDIO PROJECT />` → noustelos.gr, με το `/>` στο ακριβές treatment
  του studio (μικρότερο, ελαφρύτερο, σηκωμένο από τη γραμμή).

> Ολόκληρο το concept, η αγορά **και των δύο** domains και το live Under Construction
> έγιναν μέσα σε **μία νύχτα** (13→14/08/2026).
