# Neuraxis — Design Document (v2)

*A game that teaches the structure of the nervous system, in real depth, by taking
the player from orientation to expert clinical localization — and keeps them
coming back long enough to actually retain it.*

Status: **proposal / plan**. Nothing is built yet. v2 incorporates two independent
design reviews (pedagogy/game-design and UI/UX). Changes from v1 are summarised in
§12.

Working title: **Neuraxis** (the title is still open — an alternative was raised
and is being confirmed).

---

## 0. The one design idea everything hangs off

**One rich, typed neuroanatomy dataset. Many lenses onto it.**

Every mode — Atlas, Cases, Drill, Time Attack, Ride-the-Tract — reads the *same*
structured content model: a `Structure`, a `Tract`, a `VascularTerritory`, a
`Syndrome`, a `CrossSection`. Author the neuroanatomy *once*, correctly and
completely, and the modes are just different questions asked of that data.

v2 pushes this idea one level further, because the reviews showed it was
under-used: **the "many lenses" system is also the retention engine** (§4). The
spaced-repetition scheduler decides *which fact is due*; the lens system decides
*how it's shown* — as a flashcard, a clue in a case, a hop in Ride-the-Tract, an
Atlas click. The player doing their daily retention never has to feel like
they're "doing flashcards."

Why this architecture:
- **Accuracy is centralised.** One fact, one place. No drift between modes.
- **Content scales without re-architecting.** New region = new data; modes light
  up for free.
- **Types enforce completeness.** A `Tract` with no `decussationLevel` won't
  compile. Nothing is half-authored.
- **Retention rides on it.** Same fact, different skin each day → spaced
  retrieval that doesn't feel like a chore.

---

## 1. Who this is actually for (the framing that drives the design)

There is **one real user**: a neurology resident doing Facharzt prep, whose
motivation (per `CLAUDE.md`) runs *hot* for novelty, urgency, and audience, and
*cold* for slow-reward factual scaffolding.

The dominant risk is **not** that the game gets too hard. It's that the early,
easy rungs are things he already knows, and the design forces him to grind
through them to reach the payoff (Cases, Ride-the-Tract). Re-teaching a resident
the gracile fasciculus *is* the cold slow-reward loop he avoids.

**Ordering principle for the whole design: protect against resident-boredom
first, beginner-bounce second.** Keep a smooth easy→hard ramp — it's good
architecture and cheap — but never let it gate the expert away from the payoff.
Most of the P0 decisions below follow from this.

---

## 2. The pedagogical spine (easy → hard, without boring the expert)

### 2a. Follow the signal (the narrative spine)

Taught **bottom-up, the way a signal travels** — periphery → cord → brainstem →
thalamus → cortex for sensation, the reverse for motor. This teaches tracts as
*routes with relays and decussations*, not isolated facts. It mirrors embryology
and clinical localization (a deficit tells you *where*). By the time the player
reaches cortex they've "ridden" every major pathway that gets there.

### 2b. Bloom ladder per region (the depth spine)

For any structure/region, five rungs. Difficulty is two-dimensional: you move
*along* the neuraxis (breadth) and *up* the ladder (depth).

1. **Locate** — point to it on a diagram. (Atlas)
2. **Name & function** — recall name and what it does. (Drill)
3. **Connect** — inputs/outputs, tracts through it, decussation, blood supply.
   (Drill, Ride-the-Tract)
4. **Localize** — clinical: a deficit points here. (Cases)
5. **Master** — fast recall + long-term retention + integrated cases. (Time
   Attack, SRS, bosses)

### 2c. Test-out, don't trust *(P0 — the anti-boredom mechanism)*

Per-region hard gating (must pass Locate→Name→Connect before Cases unlock) is
right for a novice and a cage for a resident. Instead, **calibration / test-out**:

- Each Act and each node offers a short **calibration** — 4–6 questions from
  rung 3–4 of that region.
- Passing marks rungs 1–2 as `learned` (sets the high-water mark) **but still
  seeds their SRS cards at a short interval**. The claim of knowing is *verified
  by retrieval over the coming weeks*, not trusted. `learned` fills immediately;
  `retained` starts low and SRS proves it out.
- This is the **testing effect** doing double duty: it respects his expertise
  *and* is better learning science than re-teaching.
- Copy: *"Calibrating. Answer these and we'll skip what you already hold."* →
  on pass: *"Marked as known. It will still return in review until it's proven
  to stick."*

---

## 3. The curriculum — the whole nervous system, sequenced

Storyteller framing: a journey up the neuraxis, told in **Acts**. Each Act is a
region; each contains **Chapters** (lessons) feeding all modes; each ends in a
**boss** — an integrated case that gates the next Act (the one hard gate, §5b).

Full scope below — the endpoint is "knows the nervous system in fine detail."
Delivered incrementally (§11), and authored by **clinical yield first**, not
anatomical completeness.

### Act 0 — Orientation → repurposed as onboarding *(P0: not graded content)*
For a resident, a graded Act 0 is pure review and the most boring possible start.
**Act 0 becomes the tutorial**: it teaches *the game* (how each mode works) using
anatomy he already owns (planes, decussation concept, gray/white, nucleus vs
tract), rather than a region he must "master." Fast, optional, skippable. It
kills the most boring part of the ramp by turning it into onboarding (§9.1).

### Act 1 — Spinal Cord
- External: segments, cervical/lumbar enlargements, conus, cauda equina, filum,
  meninges.
- Cross-section: gray-matter horns and **Rexed laminae**; white columns.
- **Ascending:** DCML (gracile/cuneate), anterior & lateral spinothalamic, dorsal
  & ventral spinocerebellar.
- **Descending:** lateral & anterior corticospinal, rubrospinal, reticulospinal,
  vestibulospinal, tectospinal.
- Reflex arc, lower motor neuron, anterior horn.
- Blood supply: anterior spinal artery, posterior spinal arteries, radicular
  supply, watershed.
- **Clinical:** Brown-Séquard, central cord / syringomyelia, ASA syndrome,
  posterior cord, ALS, subacute combined degeneration, tabes dorsalis, conus vs
  cauda.

### Act 2 — Brainstem
- Medulla (closed & open), pons, midbrain cross-sections.
- The **"rule of 4"** localization scaffold.
- **CN nuclei:** the four functional columns and positions; which nuclei at which
  level. CN I–XII: nuclei, components, exit points.
- Long tracts through the brainstem (corticospinal, DCML→medial lemniscus,
  spinothalamic, trigeminothalamic) and where each sits at each level.
- Key nuclei: red nucleus, substantia nigra, inferior olive, reticular formation,
  raphe, locus coeruleus, colliculi.
- Blood supply: vertebrobasilar; PICA/AICA/SCA; paramedian vs circumferential.
- **Clinical:** Wallenberg, medial medullary (Déjerine), Weber, Benedikt, Claude,
  Millard-Gubler, Foville; INO, one-and-a-half, locked-in.

### Act 3 — Cerebellum
- Lobes (anterior/posterior/flocculonodular), vermis vs hemispheres, deep nuclei
  (dentate, emboliform, globose, fastigial).
- Peduncles (superior/middle/inferior) and contents.
- Functional zones: vestibulo-, spino-, cerebro-cerebellum.
- Microcircuit: mossy vs climbing fibers, Purkinje output, the loop.
- **Clinical:** midline (truncal) vs hemispheric (appendicular, ipsilateral);
  dysmetria, dysdiadochokinesia; localization.

### Act 4 — Diencephalon
- **Thalamus:** nuclei (VPL, VPM, LGN, MGN, VA, VL, DM, pulvinar, anterior,
  intralaminar) and cortical connections — the relay logic.
- **Hypothalamus:** nuclei and functions; pituitary axis.
- Epithalamus (pineal, habenula); subthalamus (STN).
- **Internal capsule:** limbs and contents — the bridge to cerebrum.
- Blood supply (thalamoperforators, thalamogeniculate); Déjerine-Roussy.

### Act 5 — Cerebrum
- Lobes; gyri/sulci; functional cortical areas — motor/sensory homunculus, Broca,
  Wernicke, primary visual/auditory.
- White matter: association (arcuate/SLF, uncinate, cingulum), commissural (corpus
  callosum, anterior commissure), projection.
- **Basal ganglia:** caudate, putamen, globus pallidus (int/ext), STN, SN; the
  direct/indirect/hyperdirect pathways.
- Ventricles & CSF; meninges; venous sinuses.
- **Vascular:** circle of Willis; ACA/MCA/PCA territories & syndromes; watershed;
  lenticulostriate lacunes.
- **Clinical:** cortical localization; the aphasias; visual-field defects; ACA vs
  MCA vs PCA; capsular lacunar syndromes.

### Act 6 — Systems & Integration *(hardest — the payoff)*
Whole pathways end-to-end and cross-level cases.
- Sensory pathways (pain/temp, fine touch/vibration, proprioception) receptor→cortex.
- Motor pathways (pyramidal, extrapyramidal).
- Visual pathway retina→cortex with the field-defect map per lesion site.
- Auditory & vestibular pathways.
- Autonomic (sympathetic/parasympathetic; Horner's).
- Limbic system, Papez circuit, memory.
- **Grand-rounds bosses:** vignettes requiring localization across multiple levels.

---

## 4. The retention engine — the daily loop is a case, not a flashcard *(P0)*

The plan's largest v1 contradiction: **SM-2 + a daily due queue is exactly the
cold, slow-reward loop this user avoids.** A streak badge won't save it. The fix
uses the "many lenses" architecture as the retention mechanic:

- **The SRS scheduler decides *which facts are due*. It does not decide how they
  are shown.**
- A **skin-dispatch layer** renders any due fact in one of several skins: naked
  flashcard, a clue inside a **Case of the Day**, one hop in Ride-the-Tract, an
  Atlas click, a cloze. The daily queue picks the skin by what's due *and* a
  novelty budget (don't show the same fact in the same skin twice running).
- The daily session **cold-opens on a Case of the Day** whose clues are drawn from
  the highest-priority due cards. He thinks he's playing detective; he's doing
  spaced retrieval. Storyteller + urgency + testing effect in one move.

This is the difference between "an SRS app with a story theme" and "a game whose
story mechanically *is* the SRS." **Build the skin-dispatch layer — it is the
retention strategy.**

### 4a. Cap the obligation, age the backlog *(P0)*
The #1 reason people quit SRS apps is the **backlog avalanche** — miss four days,
open to 300 due cards, feel guilt, never return. Fatal for an ADHD user.
- Daily due queue is **capped** (default ~15 min or N items; user-adjustable).
- After a gap, surface at most one extra day's worth; **age the rest gracefully**
  (overdue cards lose priority weight, they don't stack into a wall).
- Day boundary is explicit **Europe/Berlin**, so "due today" is stable offline and
  doesn't drift with device clock or travel.
- Calm framing: *"12 due today"* — never *"You're behind."* If regions have faded:
  *"3 regions fading"* + one-tap "refresh these," never a guilt screen.

### 4b. Interleave *(P1)*
The daily queue **interleaves** regions and modes rather than blocking
all-cord-then-all-brainstem. Interleaving is one of the best-evidenced retention
levers and costs only queue-ordering logic.

---

## 5. Progression, mastery, and gating

### 5a. The two bars — concrete formulas *(P1)*
- **Learned (per structure)** = fraction of Bloom rungs passed ≥once, where
  "passed" = ≥1 correct on that rung's question type. High-water mark; **does not
  decay**. `learned = rungsPassed / 5`.
- **Retained (per structure)** = derived from SRS state:
  `retained = clamp01( mean over cards of ( min(interval / TARGET, 1) ×
  recentAccuracy ) )`, `TARGET ≈ 21 days` = "solidly retained." Overdue cards
  pull it down as they age. **Decays with neglect** — this drives the "fading map."
- **Region green (mastered)** iff `learned ≥ 0.8 AND retained ≥ 0.7`.
- **Rung unlock:** rung N+1 opens when the last *k* attempts at rung N hit
  threshold (e.g. 3 of last 4 correct). Not "one correct" (too loose), not "fully
  mastered" (too slow).

### 5b. Soft-gate the map, hard-gate only the bosses *(P1)*
Full per-Act hard gating fights the novelty-jump instinct (he sees a Wallenberg on
shift, he wants to open Wallenberg *now*).
- **Any node is openable.** Locked-ahead nodes show a quiet prereq note
  (*"You haven't ridden the spinothalamic yet — this will be harder than it needs
  to be"*) and don't count toward mastery until prereqs are green.
- **One hard gate: the end-of-Act boss.** Earned narrative payoff and legitimate
  desirable difficulty. A "peek" at the next Act's map keeps the forward pull.

---

## 6. The game modes (the lenses)

All read the shared dataset; all feed one progression system. Listed in
Bloom-ladder order (which is also how the NodeSheet lists them, §8.2).

1. **Atlas — spatial identification.** Clickable schematic cross-sections. Two
   directions: *name→click* and *click→name*; drag-to-place variant (Kinesthete).
   Rung 1; the most-used early mode. (Interaction: §8.3.1)

2. **Drill — quiz + spaced repetition.** Adaptive bank; cards generated from the
   content model plus hand-authored hard cards. **SM-2** persisted in IndexedDB
   drives the daily due queue (rendered through the skin layer, §4). Self-grade
   via **3 buttons — Again / Hard / Good** (§8.3.3). Rungs 2–3.

3. **Cases — lesion detective.** A vignette of deficits → localize (**level +
   side + structure/territory**) → the syndrome is revealed and explained.
   Rungs 4–5, the Storyteller heart, and the default skin for the daily Case of
   the Day. **Graded partial credit** per axis. (Interaction: §8.3.2)

4. **Ride the Tract — signature connectivity mode.** A signal travels a pathway;
   at each relay and decussation the player routes it *on the board itself*
   (tapping the next node / choosing to cross sides). Wrong route → it **shows the
   resulting deficit** rather than just buzzing. Rung 3, and the mode that makes
   this not-just-a-quiz. **Protect its build budget** — if it collapses to
   multiple-choice-with-a-map, the differentiation thesis fails. (Interaction:
   §8.3.5)

5. **Time Attack — timed mastery.** Rapid-fire on already-mastered material;
   combo, lives, personal-best "ghost." Self-Competitor's mode. **Guardrails
   (P1):** it is the *weakest / least differentiated* mode, and rewarding speed
   can inflate mastery — so it draws **only** from `verified`, non-`contested`
   facts at rungs where recall should be automatic, and its **score is kept
   separate from the untimed retention score** so speed never masquerades as
   mastery. Don't cut it (it's the Competitor's hit) — fence it. (Interaction:
   §8.3.4)

---

## 7. Making wrong answers teach *(P0 — this is the product)*

The "why did I get this wrong" moment is both the core learning event and the
"click of a system resolving" the design is built around. It is first-class:

- Every question template carries a structured **`explanation`** (why the right
  answer is right) **and per-distractor `whyWrong`**.
- **Distractors must teach (P1).** A random wrong option is a giveaway.
  `questionGen` pulls distractors from the *same cross-section / same level / same
  functional column* — the anatomically adjacent confusions a resident actually
  makes.
- **Localization contrast:** don't just reveal the answer — show *why the chosen
  wrong site fails* (*"that would give you the arm, but not the crossed face"*).
  The highest-value teaching moment in clinical neuro.
- **Ride-the-Tract's wrong-route** shows the resulting **deficit map** (*"contralateral
  loss, two levels down"*) — desirable difficulty made visible.
- The explanation panel's structure and the cross-links to the *same fact in
  another mode* are specified in §8.4.

---

## 8. UX architecture

Mobile-first (Samsung S25 Ultra, Android Chrome PWA), keyboard-friendly on Mac.
Calm, spare, exact. Storyteller labels. European conventions (24h, Monday week,
ISO-8601). Fully offline. Viewport assumptions ~412×915 CSS px; primary actions
live in the bottom ~60% **reach zone**.

### 8.1 Information architecture & navigation

**The journey map is home; a 4-tab bottom nav is the spine.** The five *modes are
not nav destinations* — they launch contextually from a region or from the daily
queue, so the app answers *"what should I do next?"* instead of making the user
pick a mode cold.

```
┌─────────────────────────────────────────┐
│  Map        Today       Stats     More   │
│ (journey)  (SRS queue) (mastery) (settings/review)│
└─────────────────────────────────────────┘
```

Nav tree:

```
AppShell
├── Map ───────── JourneyMap (home)
│                   └── NodeSheet (bottom sheet per region)
│                         └── ▸ Atlas / Drill / Cases / Ride / Time Attack / Boss
│                             (launched scoped to this region)
├── Today ─────── daily SRS queue → Drill (mixed regions, skinned) → SessionSummary
├── Stats ─────── mastery, bars, streak, personal bests → Achievements
└── More ──────── Settings → ContentReview · replay Onboarding · Data export/reset

(any mode) ────── SessionSummary → returns to launch context
```

Two launch paths into the same modes, deliberately: **from a region** = "work on
the brainstem" (scoped); **from Today** = "keep me retained" (mixed due queue, the
habit loop). `Today` carries the app's *only* numeric badge (due count; absent
when zero). Screen inventory: `AppShell, Onboarding, Settings, JourneyMap,
NodeSheet, Atlas, Cases, Drill, TimeAttack, RideTheTract, BossEncounter, Today,
Stats, Achievements, ContentReview, SessionSummary`.

### 8.2 Home / journey map

The emotional center. In three seconds it must read: *where am I, what's alive,
what's next.*

- **A single vertical schematic spine, travelled bottom-up** — cord at the bottom,
  cerebrum at the top; scrolling *up* is moving rostrally. The navigation gesture
  and the anatomy are the same motion. It's a stylised transit-map spine (metro
  line, not MRI) — the literal anatomy is Atlas's job.
- **Node states (four), derived from §5a:**
  - **Locked** — hollow ring, low-contrast, lock glyph; tap explains the prereq.
  - **Available** — solid stroke + fill, the active frontier.
  - **Learned** — filled + checkmark-in-ring glyph.
  - **Retained** — learned + a thin **outer "retention halo"** that *drains as
    cards come due*, so the map itself shows decay with no numbers. Never
    color-alone: each state has a distinct glyph + stroke too.
- The **spine segment (conduit)** between two nodes lights upward as the lower one
  completes — reinforcing the signal-travelling metaphor.
- **One computed CTA pill**, docked in the reach zone, answers the one question in
  priority order: `Review — N due` → `Attempt the boss — <Act>` → `Continue —
  <node>` → `Explore`. Never a menu at the top level.
- Opens **centered on the frontier node** ("where you are"), soft-magnetic settle
  to Act stations; a left **Act rail** (dots 0–6) scrubs/jumps.
- Tapping a node opens **NodeSheet** (draggable bottom sheet): region name, the two
  bars, chapter list, and modes **in Bloom-ladder order**; a mode the region isn't
  ready for is disabled *with the exact reason shown*, never silent grey.

### 8.3 Per-mode interaction

**Shared chrome:** thin top bar (`✕ close`, progress `3/10`, optional
lives/timer). No bottom nav inside a mode (focus). Feedback grammar is shared
(§8.4).

**8.3.1 Atlas.** SVG fills upper ~62%; prompt + answer in the reach zone.
- *Name→Locate:* prompt names a structure; user taps it on the SVG.
- *Locate→Name:* a structure is highlighted; user picks from a 4-chip row or types
  (autocomplete, dictation-tolerant).
- **SVG detail:** each structure is a `<g>` with a generous invisible hit area
  (≥44px effective; small structures get an inflated transparent hit path). Tap =
  select + immediate fill highlight + a **pinned callout** with a leader line,
  placed to dodge the thumb. **Drag-to-place** variant snaps label chips to the
  nearest hit area. **Overlap** resolved by a z-ordered **tap-cycle** (tap again
  → structure beneath; comment this in code — it's the non-obvious bit).

**8.3.2 Cases.** Vignette card (2–4 sentences, dictation-clean) up top;
localization is a **structured three-part answer**: **Level** (segmented / mini-
neuraxis picker) · **Side** (L/R/Midline) · **Structure/territory** (chip list
*filtered by the chosen level* — choosing "Medulla" narrows the options, which
itself teaches association). Submit reveals the syndrome + a lit lesion location +
per-deficit *why*. **Partial credit per axis** (`Level ✓ · Side ✓ · Structure ✗`)
so the resident learns *which* part of localization they missed.

**8.3.3 Drill.** One calm card, big legible stem (≥18px). Card types: 4-choice
MCQ, true/false, type-the-answer (dictation-tolerant), image-cued. After reveal,
self-grade with **3 buttons — Again / Hard / Good** (mapped to SM-2 q-values
internally). *Tradeoff, named: 3 buttons drop the "Easy" interval stretch of the
full 6-point scale; accepted for calm/less-is-more, revisit if intervals feel
tight.* Keyboard: `1–4` select, `Enter` reveal, then `1–3` grade, `Esc` close.

**8.3.4 Time Attack.** Thin depleting timer + combo + 3 life glyphs; rapid MCQ /
quick-locate from rung-3+ `verified` material only. Tap = instant advance;
correct extends time + combo, wrong costs a life + breaks combo. A **ghost** of
the previous best's pace shows quietly. No mid-run explanations (breaks flow);
wrongs are banked into SessionSummary's review list.

**8.3.5 Ride the Tract.** A schematic neuraxis **board** with two side-columns
(left/right → decussation = physically crossing columns) and relay nodes; a
**signal token** at the current position. Each step: 2–3 candidate nodes light on
the board; the player **taps the next node** (or "cross here"). Correct → the
token **travels** the route (the one signature animation, §8.7) and the conduit
lights. Wrong → the token stays and a muted overlay shows *"if it went there, the
deficit would be…"*, then the correct target is gently indicated for a retry.
Completing the route = signal reaches cortex/muscle + a full traced summary naming
every relay and decussation.

### 8.4 The feedback moment

One consistent grammar across all modes so the user never re-learns "am I right?"

**Three redundant channels (never color alone):** ① **glyph** ✓ / ✗ / ◌
(shape-distinct) · ② **color** (colorblind-safe pair, §8.5) · ③ the correct answer
is **always surfaced** (reinforced when right, shown lit/outlined when wrong).
Motion is an optional fourth channel, off under reduced-motion — never
load-bearing.

Placement is in/near the reach zone. In teaching modes, a correct answer shows a
brief affirmation with the **why panel collapsed** (`Why` toggle); a wrong answer
**expands it by default**. Time Attack: ~250ms flash, no panel, wrongs banked.

**The "why was I wrong" panel** — four fixed parts, in order:
1. **Restate their answer** plainly ("You chose: Rubrospinal tract").
2. **Give the correct one** ("Correct: Lateral corticospinal tract").
3. **The mechanism (why)** — 1–2 exact, attending-voiced sentences.
4. **Cross-links** — the *same fact seen through another mode* ("▸ Ride the Tract:
   corticospinal", "▸ Brown-Séquard case"). This operationalises the core idea:
   the moment you're wrong is the moment you're offered the other views.

Copy voice: exact, no filler. *"Not quite."* not *"Oops, almost!"*. No exclamation
points (not narrative).

### 8.5 Visual design system

Medical-serious, calm, light **and** dark. Neutral-cool base, one restrained
accent, and a correctness pair that is **blue/orange, deliberately not red/green**
(colorblind-safe).

**Neutrals — light:** `bg #F7F8FA` · `surface #FFFFFF` · `surface-2 #EEF1F5` ·
`border #D6DBE2` · `text #161A20` · `text-muted #5A6472` · `text-faint #8A93A3`.
**Neutrals — dark:** `bg #0E1116` · `surface #161B22` · `surface-2 #1F2630` ·
`border #2C3542` · `text #E8ECF1` · `text-muted #9AA5B3` · `text-faint #5F6A78`.

**Accent (calm teal-blue):** `accent` `#2B6CB0` (light) / `#5B9BD5` (dark);
`accent-soft` `#DCE8F4` / `#1B2C3D`. Used for primary actions, active nav, the
available node, the CTA pill.

**Correctness — colorblind-safe:** `correct` `#1B7F79`/`#3FA79F` (teal-green, ✓) ·
`incorrect` `#C4661F`/`#E08A45` (amber-orange, ✗) · `partial` `#8A6D1F`/`#C0A050`
(ochre, ◌). Distinguishable under deutan/protan; always backed by glyph + text.

**Diagram semantics (inside SVGs only):** `dia-stroke` `#3A424E`/`#B8C0CC` ·
`dia-selected` = accent · `dia-highlight` `#7C3AED`/`#A985F0` (violet "target"
cue, kept separate from judgement colors) · `dia-correct`/`dia-incorrect` = the
correctness pair. Strokes use `vector-effect: non-scaling-stroke`; default
structure 1.5px, selected 2.5px, map spine 3px. State also carries a glyph or
**stroke pattern** (highlight = dashed, selected = heavy solid) so diagrams read
in greyscale.

**Type:** system stack (no web-font fetch) `-apple-system, "Segoe UI", Roboto,
"Noto Sans", sans-serif`. Scale: `display 28/34·600` · `title 22/28·600` ·
`body-lg 18/26·400` (question stems, vignettes) · `body 16/24·400` ·
`label 14/20·500` · `caption 12/16·500`. Tabular numerals for counts/timers.

**Spacing/radius:** 4px grid (`8·12·16·24·32`), 16px gutter/card pad. Radius
`sm 8` (chips) · `md 12` (cards/buttons) · `lg 20` (sheets, pill) · `full`
(toggles, node rings).

**Components:** Button (primary/secondary/ghost, ≥48px, disabled shows reason on
tap) · Chip (≥44px, states with glyph) · Card · Bottom sheet (grab handle,
drag-dismiss) · two Progress bars (`learned` fills once & static; `retained` thin
& depleting = the map halo) · Map node (ring+fill+glyph+halo, ≥56px) · CTA pill ·
Timer bar (ghost tick) · Signal token · Badge (`draft` ochre / `verified` teal
outline; achievements).

### 8.6 Accessibility

- **Contrast (WCAG AA+):** body ~15:1; muted ~5.6:1; accent ~5.1:1 on white.
  Add a **build-time contrast check** over token pairs (comment it as load-bearing).
- **Touch targets** ≥44px (map nodes ≥56px), ≥8px apart; small SVG structures get
  inflated invisible hit paths.
- **Clickable SVG:** each structure `<g role="button" tabindex="0"
  aria-label="Gracile fasciculus, dorsal column">`; SVG root `role="group"` +
  label. **Focus order = anatomical reading order** (dorsal→ventral,
  medial→lateral), authored per section. `Tab`/`Enter` navigate/select with a 2px
  offset focus ring. A visually-hidden **`aria-live="polite"`** region announces
  feedback ("Incorrect. You selected cuneate; the gracile fasciculus is medial.").
- **Reduced motion:** honor `prefers-reduced-motion` — decorative motion off; the
  Ride-the-Tract signal *crossfades* between nodes instead of travelling; settle/
  shake become instant state changes.
- **Colorblind-safe:** the three-channel rule everywhere; a high-contrast setting
  thickens glyphs and separates fills further. Verify by rendering greyscale.
- **Dictation tolerance (this user):** every typed input normalizes whitespace,
  strips trailing punctuation, accepts case-insensitive + close match (Levenshtein
  ≤2 / synonym table). Never mark a right answer wrong over a stray space.
- **Text scaling:** `rem`-based, flexes to 200% without clipping.

### 8.7 Motion

Most things don't animate. Durations 150–250ms, gentle `ease-out`, nothing
bouncy. **Animate:** node becoming `learned` (soft settle + conduit filling
upward), sheet slide, feedback-panel expand, correct/incorrect micro-settle/shake.
**Don't animate:** screen transitions (cut), map scroll (native), numbers (no
count-up). **The one signature moment:** Ride-the-Tract's signal **travelling** its
route (~500–700ms; full-route completion traces receptor→cortex end to end) — the
visual "click" the whole design is built around. Degrades to crossfade under
reduced-motion.

### 8.8 States

- **Onboarding (Act 0):** three swipeable panes ≤2 sentences each, then a real
  trivial first move ("Point to the dorsal columns"), one feedback moment, and
  you're in. <30s, always `Skip`. Storyteller voice, never "Welcome! Let's get
  started."
- **Empty map:** only Cord `available`; everything above visible-but-dimmed so the
  scope is *felt*. CTA: `Begin — Spinal Cord`.
- **Nothing due today:** *"Nothing is due for review. Your retention is current."*
  + streak held + optional forward doors (`Continue`, `Time Attack`) — never
  obligatory, no confetti. Streak holds by having cleared the queue (or nothing
  being due); it doesn't demand busywork on a clear day.
- **Loading:** IndexedDB is near-instant — **skeletons**, not spinners; static
  under reduced-motion.
- **Error:** *"Something didn't load. Your progress is safe locally."* + `Retry`.
  A bad content record fails **absent, not wrong** (§10) and is surfaced in
  ContentReview.
- **Offline:** the normal state — no scary banner; one dismissible first-install
  note ("Neuraxis runs fully offline. Everything is stored on this device.").

### 8.9 Session shape (a typical 10–15 min mobile session) *(P1)*

The loop is **Map → CTA → do the due thing → optional one region-forward → see the
map change.** Retention is the (short, guided) obligation; exploration is the
(optional, chosen) reward.

| Time | Segment | Play type served |
|---|---|---|
| 0:00–1:00 | **Case of the Day** cold open (due cards as clues) | Storyteller, urgency, novelty |
| 1:00–7:00 | **Due review**, mixed skins, interleaved regions | retention, disguised |
| 7:00–12:00 | **One new move** — a node or one rung up: teach → immediate test | novelty |
| 12:00–14:00 | **Time Attack** sprint on mastered material | self-Competitor |
| 14:00–15:00 | **Close** — map updates, "what resolved today," attending note, tomorrow's hook | metacognition, forward pull |

A user with 4 minutes does the cold-open + review and stops, fully "complete." A
user with 15 does the whole arc. Neither is punished. The SRS obligation is
discharged inside segments 1–2 without ever being the visible point.

---

## 9. Motivation mechanics for this specific user

- **Manufacture the "audience" he runs hot on (P1):** an **attending narrator**
  voice reacting to reasoning (calm, exact — a good attending, not a cheerleader),
  as a *mechanic*, not just copy. A **teach-back** move occasionally asks him to
  explain a localization (structured picker; free-text deferred to v1.5 because
  dictation artifacts break exact matching), then reveals the model answer to
  self-grade — teaching is his *primary* play type. An exportable **case-report /
  stat card** he can screenshot = audience without a backend.
- **Mnemonics as first-class content (P1):** neuro is the most mnemonic-dense
  subject in medicine (rule of 4; the CN columns; Wallenberg). Add a `mnemonic`
  field to structures/syndromes — cheap, high-yield, on-brand, lands the "new
  move."
- **A visible "weak spots" log (P1):** a running list of most-missed items turns
  wrong answers into an attackable target — fuel for the self-Competitor, closes
  the metacognitive loop. Cheap (query the stats table).
- **(P2) Confidence calibration** (occasional "how sure?", flag *confidently-wrong*
  items — the dangerous ones for a clinician); **retention-over-time chart** in
  Stats (tells *him* whether the app is actually working — honest feedback on the
  premise; calm palette, not a gamer aesthetic).

---

## 10. Accuracy strategy ("very accurate")

Built for a neurologist — wrong is worse than absent.

- **Typed, complete records** (TypeScript): every tract specifies origin,
  decussation, destination, function, lesion effect. Nothing half-specified.
- **`reviewStatus`** (`draft` / `verified`) + optional `note` on every record.
  Anything I author but am not fully certain of ships `draft`, surfaced in the
  **ContentReview** screen so the domain expert verifies or corrects it — expert
  in the loop by design.
- **`contested` / `levelOfDetail`** flag for genuinely variable facts (variant
  vascular supply, exact laminar destinations). **Contested facts are excluded
  from Time Attack** — you can't demand a fast single answer to an "it depends."
- **Fun-vs-accuracy rule:** *when they conflict, degrade the fun, not the fact —
  and the required degradation is almost always a label, not a feature cut.*
  Ride-the-Tract discretizes continuous tracts into hops (schematic, and says so);
  Cases give **graded partial credit** for near-misses because real localization
  is probabilistic.
- **Diagrams are schematic (see §6-of-v1 / honest tradeoff below).**

**Diagram tradeoff, stated plainly:** hand-authored **schematic** SVGs —
topologically correct, labeled, clickable — *not* photorealistic atlas plates.
For a localization learning game this is the correct choice (clearer, isolates the
teaching point, interactive), but it won't look like Netter and isn't a substitute
for an atlas when studying surface morphology. Photoreal later = a separate, much
larger effort.

---

## 11. Technical architecture & delivery

Stack kept close to what's proven here — **Vite + React + TS + Tailwind + Dexie +
`vite-plugin-pwa`** — a genuinely good fit (offline-first, installable on the S25,
no backend) and already familiar. Freed from the *old file structure*, not
switching frameworks for novelty.

```
src/
  content/     the neuroanatomy dataset — the crown jewels
    structures.ts  tracts.ts  vascular.ts  sections.ts  syndromes.ts
    curriculum.ts  questions.ts        # labels stored as { en, de? } (§12)
  engine/
    srs.ts         # SM-2 scheduling, Europe/Berlin day boundary, backlog aging
    skins.ts       # skin-dispatch: render a due fact as flashcard/case/ride/atlas
    progression.ts # learned/retained formulas, unlock gating
    questionGen.ts # derive cards + teaching distractors from the model
    scoring.ts     # Time Attack scoring, combos, ghosts (separate speed score)
  db/            # Dexie: srsCards, mastery, stats, weakSpots, achievements, settings
  diagrams/      # one clickable schematic SVG per cross-section/view
  modes/         # Atlas, Cases, Drill, TimeAttack, RideTheTract, BossEncounter
  ui/            # AppShell, JourneyMap, NodeSheet, feedback panel, design tokens
```

**Content pipeline hardening (P1 — the long pole is *authoring*, not code):**
- **Runtime schema validation (Zod alongside TS)** so drafts validate on load.
- **Content lint** flags: missing `decussationLevel`; orphan refs (a syndrome
  pointing to a nonexistent tract); Atlas hotspots with no backing structure;
  structures with zero derivable questions.
- **Author via a typed builder / form → generate TS**, not hand-written object
  literals (the error-prone part).
- ContentReview **diffs draft↔verified and allows bulk-verify** — optimise *his*
  verification clicks, the real bottleneck.
- Track **cards-per-authored-structure** (the "many lenses" model should yield
  ~8–15 questions/structure for free; if it yields 2, the generator is under-built).

### 11a. Delivery plan — vertical slice first *(revised from v1)*

Build the **smallest end-to-end slice through all five modes before the content
pour**, to de-risk the modes (especially Ride-the-Tract's UX) on a tiny content
footprint. Then author by clinical yield.

1. **Foundation** — repo restructure; typed content model + Zod + DB schema;
   AppShell + 4-tab nav + empty JourneyMap; design tokens. *(skeleton, no content)*
2. **Vertical slice content** — *one* cord cross-section, ~6 structures, 2 tracts
   (DCML + spinothalamic), 1 syndrome (Brown-Séquard) — authored in the typed
   model with `reviewStatus`.
3. **Drill + the feedback moment** on the slice — first complete loop; the
   feedback panel (§8.4) is the pattern everything else inherits.
4. **Atlas** — the cord cross-section, clickable.
5. **Cases** — Brown-Séquard as a lesion-detective case (partial credit).
6. **Ride the Tract + Time Attack** on the slice; skin-dispatch layer; SessionSummary.
   → *At this point there is a complete, fun game on a six-structure slice — the
   proof the whole thing works.*
7. **Author outward by clinical yield** — high-yield spine first (DCML,
   spinothalamic, corticospinal, Wallenberg, capsular stroke), then the rest of
   Act 1, then Acts 2→6. Diagrams and cases expand act by act. Additive, not
   structural.

Each increment ≈ one of Deepak's 60–90-min sessions. **Honest scope note:** the
architecture is the fast part; authoring resident-accurate content for all of
Acts 0–6 is a large body of work — this is the long pole and is named as such.

---

## 12. What changed from v1 (review synthesis)

The v1 plan was architecturally sound; the reviews sharpened it in five ways:
1. **Stopped optimizing for a beginner who doesn't exist.** Protect against
   resident-boredom first: Act 0 → onboarding, test-out calibration, soft-gated map.
2. **Made the daily loop a case, not a flashcard.** The "many lenses" idea is now
   the *retention* engine (skin-dispatch), with a capped queue and graceful backlog
   aging — because SM-2-as-flashcards is the exact loop this user avoids.
3. **Made wrong answers the product.** Structured `explanation` + per-distractor
   `whyWrong`, teaching distractors, localization contrast, deficit-map on
   mis-routes.
4. **Added a complete, buildable UX** (§8): 4-tab nav, bottom-up journey map with
   a draining retention halo, per-mode wireframes, a three-channel colorblind-safe
   feedback grammar, a full light/dark design system, accessibility, states,
   motion, and the minute-to-minute session shape.
5. **Reordered delivery to a vertical slice** through all five modes before the
   content pour, and hardened the content pipeline (Zod, lint, builder,
   bulk-verify) since authoring — not code — is the long pole.

Localization/German: labels stored as `{ en: string; de?: string }` — `en`
required, `de` optional. English UI in v1; German becomes a later toggle, not a
rebuild. Near-zero authoring tax now.

---

## 13. Open questions

- **Title.** "Neuraxis" is the working name; an alternative was raised and is being
  confirmed before it's wired into the app name / PWA manifest.
- **Content-review depth.** How much does Deepak want to verify vs. trust? The
  `draft`/`verified` + bulk-verify flow supports either.
- **Scope realism.** Acts 0–6 in full detail is a large authoring effort; the
  vertical-slice-first plan (§11a) gets a complete, fun game early and pours the
  rest in additively.
```
