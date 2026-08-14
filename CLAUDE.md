# AskCarnivore AI

## Το οικοσύστημα

Δύο ιστοσελίδες, ξεχωριστός ρόλος η καθεμία, αλληλοϋποστηριζόμενες.

| | **askcarnivore.com** (ενικός) | **askcarnivores.com** (πληθυντικός) |
|---|---|---|
| **Τι είναι** | AI assistant για την carnivore διατροφή | Portal κοινότητας |
| **Ρωτάς** | τη μηχανή | τους ανθρώπους |
| **Σχέση** | 1 προς 1, ανώνυμα | μέλος προς μέλος, με ταυτότητα |
| **Περιεχόμενο** | απαντήσεις κατά παραγγελία | testimonials, συζήτηση, προφίλ |
| **Πρόσβαση** | χωρίς λογαριασμό | με λογαριασμό |
| **Στάδιο** | Under Construction — **live** | δεν έχει ξεκινήσει |

Το ζευγάρι ενικός/πληθυντικός λειτουργεί υπέρ μας: το `askcarnivore` ρωτάει *τον*
carnivore (τη μηχανή), το `askcarnivores` ρωτάει *τους* carnivores (την κοινότητα).
Η διάκριση πρέπει να είναι ρητή και συνεπής παντού — αλλιώς τα δύο domains θα
μοιάζουν με typo το ένα του άλλου.

## Στοιχεία project

| | |
|---|---|
| **Domains** | `askcarnivore.com`, `askcarnivores.com` (και τα δύο στη Cloudflare, ίδια λήξη) |
| **Repo** | https://github.com/noustelos/askCarnivore-Ai |
| **Local path** | `/Users/nikoskaradimas/Desktop/ASK CARNIVORE AI` |

> Τα παρακάτω (Τρέχουσα κατάσταση, Visual identity, Deployment, Δομή) αφορούν
> **μόνο** το `askcarnivore.com`. Το `askcarnivores.com` δεν έχει ακόμα repo/κώδικα.

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

### askcarnivore.com — ο βοηθός

*(Εκκρεμεί το αναλυτικό concept από τον χρήστη.)*

### askcarnivores.com — η κοινότητα

**Δοσμένο 14/08/2026.** Portal επικοινωνίας με άλλους ανθρώπους της carnivore
κοινότητας, με έμφαση στην **ανάδειξη testimonials**. Τα δύο sites αλληλοϋποστηρίζονται.

Πυλώνες:

1. **Επικοινωνία μελών** — να βρίσκουν και να μιλούν μεταξύ τους οι carnivore.
2. **Testimonials** — προσωπικές ιστορίες/εμπειρίες, σε πρώτο πλάνο.
3. **Cross-support** — κάθε site τροφοδοτεί το άλλο.

### Πώς αλληλοϋποστηρίζονται

Η ροή που βγάζει νόημα και προς τις δύο κατευθύνσεις:

- **AI → κοινότητα:** μετά από μια απάντηση, «δες τι λένε άνθρωποι που το έζησαν» →
  σχετικά testimonials. Δίνει κοινωνική απόδειξη εκεί που η μηχανή δίνει μόνο πληροφορία.
- **Κοινότητα → AI:** μέσα σε μια συζήτηση, «ρώτα το AI» για γρήγορη, ουδέτερη
  απάντηση σε factual ερώτηση, χωρίς να περιμένεις απάντηση μέλους.
- Κοινή οπτική ταυτότητα (η παλέτα του landing) ώστε να διαβάζονται ως αδέλφια.
- Κοινό SSO όταν υπάρξουν λογαριασμοί — ένα login και για τα δύο.

### Ένταση που πρέπει να λυθεί συνειδητά

Το tagline του `askcarnivore.com` είναι **«No app. No sign-up. Just Ask.»**
Το `askcarnivores.com` απαιτεί εξ ορισμού λογαριασμούς. Δεν είναι αντίφαση αν
παρουσιαστεί σωστά — *«ο βοηθός δεν σου ζητάει τίποτα· η κοινότητα σε ξέρει με
το όνομά σου»* — αλλά πρέπει να είναι επιλογή, όχι ατύχημα. Το «no sign-up»
να μην εμφανίζεται ποτέ στο site της κοινότητας.

### Ρίσκα που έρχονται μαζί με τα testimonials

Δεν είναι λόγος να μη γίνει, είναι λόγος να σχεδιαστεί σωστά από την αρχή:

- **Ισχυρισμοί υγείας.** Testimonial τύπου «θεράπευσα το Χ με carnivore» είναι
  ιατρικός ισχυρισμός. Χρειάζεται σαφές disclaimer δίπλα στο περιεχόμενο (όχι μόνο
  στο footer) και κανόνες για το τι επιτρέπεται να δημοσιευτεί.
- **User-generated content.** Θέλει moderation, αναφορά περιεχομένου, όρους χρήσης.
- **Προσωπικά δεδομένα.** Ιστορίες υγείας = ειδική κατηγορία δεδομένων κατά GDPR.
  Απαιτεί ρητή συγκατάθεση, δυνατότητα διαγραφής, και σαφή privacy policy.
- **Αυθεντικότητα.** Τα ψεύτικα testimonials σκοτώνουν την αξιοπιστία ενός τέτοιου
  site πιο γρήγορα από οτιδήποτε άλλο. Θέλει τρόπο επιβεβαίωσης, έστω ελαφρύ.

---

## Pending / Εκκρεμότητες

- [ ] Να δοθεί το **concept** του bot (κοινό, tone, τι ακριβώς απαντάει, γλώσσα/ες)
- [x] ~~Σύνδεση repo με Cloudflare Pages + custom domain `askcarnivore.com`~~ ✅ 14/08/2026
- [ ] **Canonical domain.** Το `www.askcarnivore.com` σερβίρει το ίδιο περιεχόμενο
      αντί να κάνει redirect στο apex — δύο hostnames με ίδιο content, το οποίο
      διασπά το SEO signal. Θέλει Bulk Redirect ή Redirect Rule: `www` → apex (301).
      Καλύτερα τώρα, πριν μαζέψει links.
- [ ] Απόφαση tech stack για το bot (LLM provider, backend, chat UI)
- [ ] Πηγές γνώσης / knowledge base για carnivore περιεχόμενο
- [ ] Email capture στο coming soon (χρειάζεται backend/service — δεν υπάρχει ακόμα)
- [ ] Social links (X, Instagram, κλπ.) — δεν έχουν δοθεί ακόμα
- [ ] Λογότυπο / branding — υπάρχει χρωματική παλέτα από το landing, λείπει mark & γραμματοσειρά
- [ ] Legal: disclaimer, privacy policy, terms
- [ ] Να αποφασιστεί αν το indigo (`--c3`) μένει· wine + sear ταιριάζουν στο carnivore theme,
      το μπλε είναι το μόνο off-brand χρώμα της τριάδας
- [ ] OG image (`og:image`) για σωστό preview σε social shares

### askcarnivores.com (κοινότητα)

- [ ] **Ξεχωριστό repo + Pages project** — να επιβεβαιωθεί ότι πάει χωριστά, όχι
      στο ίδιο repo (διαφορετικό stack: το ένα στατικό, το άλλο θέλει backend)
- [ ] Coming-soon landing, αδελφό του `askcarnivore.com` αλλά με δικό του μήνυμα
      (**χωρίς** το "No sign-up" — βλ. Concept)
- [ ] Tech stack: auth, database, moderation. Το Cloudflare stack (Workers + D1 +
      KV/R2) καλύπτει και τα δύο sites αν θέλουμε να μείνουμε σε έναν πάροχο
- [ ] Δομή testimonial: τι πεδία, τι επιβεβαίωση, ποια moderation ροή πριν δημοσιευτεί
- [ ] Κανόνες περιεχομένου — τι ισχυρισμοί υγείας επιτρέπονται και τι όχι
- [ ] Legal για UGC: terms, privacy policy με GDPR ειδική κατηγορία δεδομένων, δικαίωμα διαγραφής
- [ ] Σχεδιασμός των cross-links AI ↔ κοινότητα (πού ακριβώς εμφανίζονται, τι λένε)
- [ ] Απόφαση για κοινό SSO ανάμεσα στα δύο sites
- [ ] Seed strategy: μια κοινότητα χωρίς μέλη είναι νεκρή στην εκκίνηση — πώς μαζεύονται
      τα πρώτα testimonials πριν ανοίξει;

---

## Changelog

- **2026-08-14** — Αρχικό setup: CLAUDE.md + Under Construction landing page.
- **2026-08-14** — Landing ξαναχτίστηκε πάνω στο pulse-ring concept (βλ. Visual identity).
- **2026-08-14** — Live στο `askcarnivore.com` μέσω Cloudflare Pages.
- **2026-08-14** — Το `askcarnivores.com` απέκτησε ρόλο: portal κοινότητας με
  testimonials, αλληλοϋποστηριζόμενο με τον AI βοηθό. Το project έγινε δύο sites.
