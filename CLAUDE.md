# AskCarnivore AI

## Τι είναι

Bot / AI assistant που δίνει πληροφορίες σχετικά με την **carnivore διατροφή**.

## Στοιχεία project

| | |
|---|---|
| **Domain** | `askcarnivore.com` (αγορασμένο στη Cloudflare) |
| **Repo** | https://github.com/noustelos/askCarnivore-Ai |
| **Local path** | `/Users/nikoskaradimas/Desktop/ASK CARNIVORE AI` |
| **Στάδιο** | Under Construction — landing page μόνο |

## Τρέχουσα κατάσταση

Στατική σελίδα "Coming Soon" στο [index.html](index.html). Χωρίς build step, χωρίς
dependencies, χωρίς external assets — όλα inline ώστε να ανεβαίνει όπως είναι.

**Περιεχόμενο σελίδας:** pulse ring → `Ask Carnivore Ai` → `No app. No sign-up. Just Ask.`
→ `Under Construction · Coming Soon`.

### Visual identity (landing)

Full-bleed background που κυλάει αργά ανάμεσα σε τρία χρώματα, με ένα λευκό
διπλό δαχτυλίδι που «αναπνέει» στο κέντρο.

| Token | Τιμή | Ρόλος |
|---|---|---|
| `--c1` | `hsl(343 72% 34%)` | wine |
| `--c2` | `hsl(33 85% 32%)` | sear |
| `--c3` | `hsl(223 65% 34%)` | indigo |
| `--pulse-dur` | `2.6s` | μία «ανάσα» του ring |
| `--shift-dur` | `27s` | πλήρης κύκλος χρωμάτων |

Το ring είναι διασκευή του
[Heartbeating Ring Preloader](https://codepen.io/jkantner/pen/RNKyWKd) του Jon Kantner.
Αλλαγές που έγιναν:

- SCSS → plain CSS (τα `#{}` interpolations λύθηκαν σε ποσοστά· χωρίς `sass` build).
- Το heartbeat έγινε ήρεμο pulse: `1s → 2.6s`, μικρότερο πλάτος (`r 50/sw 15 → 48/13`),
  συμμετρικό easing αντί για το snappy `ease-in`/`ease-out` ζευγάρι.
- Τα χρώματα βάθυναν από `90% 50%` ώστε το λευκό κείμενο να περνάει WCAG AA
  (8.5:1 / 5.6:1 / 9.8:1 αντί για ~2.3:1 στο αρχικό πορτοκαλί).
- `--shift-dur` `3s → 27s` — τα 3s ήταν στροβοσκόπιο.
- Προστέθηκαν: `prefers-reduced-motion`, vignette για βάθος, `100svh`,
  dark chip πίσω από το status ώστε να διαβάζεται σε κάθε φάση του κύκλου.
- Καθαρίστηκε το `width="20" height="20"` του `<svg>` που συγκρουόταν με το CSS.

## Deployment

Cloudflare Pages, συνδεδεμένο στο GitHub repo:

- Build command: *(κανένα)*
- Build output directory: `/` (root)
- Custom domain: `askcarnivore.com` + `www.askcarnivore.com`

Κάθε push στο `main` κάνει auto-deploy.

## Δομή

```
.
├── CLAUDE.md      # αυτό το αρχείο — context & εκκρεμότητες
├── index.html     # landing page (Under Construction)
└── README.md
```

## Αρχές / κανόνες

- Η σελίδα να παραμείνει self-contained (inline CSS, χωρίς CDN) όσο είμαστε σε landing φάση.
- Responsive & dark/light aware.
- Το περιεχόμενο για την carnivore διατροφή είναι **ενημερωτικό, όχι ιατρική συμβουλή** —
  θέλει disclaimer παντού όπου δίνονται πληροφορίες υγείας.

---

## Concept

*(Θα συμπληρωθεί — ο χρήστης θα δώσει το πρώτο concept.)*

---

## Pending / Εκκρεμότητες

- [ ] Να δοθεί το **concept** του bot (κοινό, tone, τι ακριβώς απαντάει, γλώσσα/ες)
- [ ] Σύνδεση repo με Cloudflare Pages + custom domain `askcarnivore.com`
- [ ] Απόφαση tech stack για το bot (LLM provider, backend, chat UI)
- [ ] Πηγές γνώσης / knowledge base για carnivore περιεχόμενο
- [ ] Email capture στο coming soon (χρειάζεται backend/service — δεν υπάρχει ακόμα)
- [ ] Social links (X, Instagram, κλπ.) — δεν έχουν δοθεί ακόμα
- [ ] Λογότυπο / branding — υπάρχει χρωματική παλέτα από το landing, λείπει mark & γραμματοσειρά
- [ ] Legal: disclaimer, privacy policy, terms
- [ ] Να αποφασιστεί αν το indigo (`--c3`) μένει· wine + sear ταιριάζουν στο carnivore theme,
      το μπλε είναι το μόνο off-brand χρώμα της τριάδας
- [ ] OG image (`og:image`) για σωστό preview σε social shares

---

## Changelog

- **2026-08-14** — Αρχικό setup: CLAUDE.md + Under Construction landing page.
- **2026-08-14** — Landing ξαναχτίστηκε πάνω στο pulse-ring concept (βλ. Visual identity).
