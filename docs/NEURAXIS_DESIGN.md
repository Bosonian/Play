# Neuraxis — Design Document

*A game that teaches the structure of the nervous system, in real depth, by taking
the player slowly from orientation to expert clinical localization.*

Status: **proposal / plan**. Nothing here is built yet. This document is the
thing to argue with before code exists.

Audience for the game: resident-level (Deepak, Facharzt prep) — but the
progression starts genuinely easy so the early acts are usable by anyone and the
ramp is smooth. "In detail" is the destination, not the entry point.

---

## 0. The one design idea everything hangs off

**One rich, typed neuroanatomy dataset. Many lenses onto it.**

Every game mode — identify-on-diagram, quiz, spaced repetition, lesion cases,
timed rounds, ride-the-tract — reads from the *same* structured content model.
A `Structure`, a `Tract`, a `VascularTerritory`, a `Syndrome`, a `CrossSection`.
Author the neuroanatomy *once*, correctly and completely, and the modes are just
different questions asked of that data.

Why this matters:
- **Accuracy is centralised.** One fact, one place. No drift between the quiz
  saying the spinothalamic tract decussates at the segmental level and the case
  mode implying otherwise.
- **Content scales without re-architecting.** Adding the cerebellum act = adding
  cerebellum data. The modes light up automatically.
- **Types enforce completeness.** A `Tract` with no `decussationLevel` won't
  compile. You can't half-author a structure.

This is the difference between "a neuro quiz app" and "a system that knows
neuroanatomy and can quiz you on it."

---

## 1. The pedagogical spine (easy → hard)

The core requirement: *goes slowly from easy to hard, and at the end the player
knows the nervous system in very fine detail.* Two structuring principles:

### 1a. Follow the signal (the narrative spine)

The nervous system is taught here **bottom-up, the way a signal travels** —
periphery → spinal cord → brainstem → thalamus → cortex for sensation, and the
reverse for movement. This is not decoration. Teaching connectivity *as a
journey* means the player learns tracts as routes with relays and decussations,
not as isolated facts. By the time they reach the cortex they have already
"ridden" every major pathway that gets there.

Bottom-up also mirrors embryology (neural tube → vesicles) and clinical
localization (a deficit tells you *where* on the neuraxis), so the story spine
and the clinical payoff point the same direction.

### 1b. Bloom ladder per structure (the depth spine)

For any given structure or region, the player climbs the same five rungs. A
region does not unlock the next until its mastery threshold is met, so difficulty
rises *within* a topic before the map moves on.

1. **Locate** — recognise / point to it on a diagram. (lowest stakes, spatial)
2. **Name & function** — recall its name and what it does.
3. **Connect** — its inputs/outputs, the tracts through it, decussation level,
   blood supply.
4. **Localize** — clinical: given a deficit, this structure is the answer.
5. **Master** — fast recall under time pressure + long-term retention via SRS +
   integrated multi-step cases.

Difficulty is therefore two-dimensional: you move *along* the neuraxis (breadth)
and *up* the Bloom ladder (depth). Early acts spend most time on rungs 1–2; later
acts live on rungs 4–5.

---

## 2. The curriculum — the whole nervous system, sequenced

Storyteller framing: the game is a journey up the neuraxis, told in **Acts**.
Each Act is a region of the map; each Act contains **Chapters** (lessons); each
Chapter feeds all the game modes. Every Act ends in a **boss encounter** — an
integrated case that can only be solved by combining that Act's content.

This is the full scope. It is deliberately comprehensive — the endpoint is
"knows the nervous system in very fine detail." It is delivered incrementally
(see §7), not all at once.

### Act 0 — Orientation *(easy, motivating, ~short)*
- Planes and directional terms (rostral/caudal, dorsal/ventral, medial/lateral).
- The idea of **decussation** — introduced early because it's the key to
  everything clinical later.
- Gross divisions: CNS vs PNS; the brain / brainstem / cerebellum / cord.
- Gray vs white matter; the vocabulary — nucleus vs ganglion, tract vs nerve,
  afferent vs efferent.

### Act 1 — Spinal Cord
- External anatomy: segments, cervical/lumbar enlargements, conus medullaris,
  cauda equina, filum terminale; meninges.
- Cross-section: gray-matter horns and **Rexed laminae**; the white columns.
- **Ascending** tracts: dorsal column–medial lemniscus (gracile/cuneate),
  anterior & lateral spinothalamic, dorsal & ventral spinocerebellar.
- **Descending** tracts: lateral & anterior corticospinal, rubrospinal,
  reticulospinal, vestibulospinal, tectospinal.
- Reflex arc, lower motor neuron, anterior horn.
- Blood supply: anterior spinal artery, paired posterior spinal arteries,
  radicular/segmental supply, the watershed idea.
- **Clinical:** Brown-Séquard, central cord / syringomyelia, anterior spinal
  artery syndrome, posterior cord syndrome, ALS (UMN+LMN), subacute combined
  degeneration (B12), tabes dorsalis, conus vs cauda equina.

### Act 2 — Brainstem
- Medulla (closed & open), pons, midbrain — the classic cross-section levels.
- The **"rule of 4"** framework (4 midline structures, 4 lateral, 4 CN motor
  nuclei that divide into 12, 4 that don't) — a resident's localization scaffold.
- **Cranial-nerve nuclei:** the four functional columns and their positions;
  which nuclei sit at which level.
- CN I–XII overview: nuclei, functional components, exit points.
- Long tracts *through* the brainstem: corticospinal, DCML → medial lemniscus,
  spinothalamic, trigeminothalamic — and where each sits at each level.
- Key nuclei/regions: red nucleus, substantia nigra, inferior olive, reticular
  formation, raphe, locus coeruleus, superior/inferior colliculi.
- Blood supply: vertebrobasilar system; PICA / AICA / SCA; paramedian vs
  circumferential perforators.
- **Clinical:** lateral medullary (Wallenberg), medial medullary (Déjerine),
  Weber, Benedikt, Claude, Millard-Gubler, Foville; INO, one-and-a-half,
  locked-in.

### Act 3 — Cerebellum
- Anatomy: anterior / posterior / flocculonodular lobes; vermis vs hemispheres;
  deep nuclei (dentate, emboliform, globose, fastigial).
- Peduncles (superior / middle / inferior) and their contents.
- Functional zones: vestibulocerebellum, spinocerebellum, cerebrocerebellum.
- Microcircuit: mossy vs climbing fibers, Purkinje output, the cerebellar loop.
- **Clinical:** midline (truncal ataxia) vs hemispheric (appendicular,
  ipsilateral) syndromes; dysmetria, dysdiadochokinesia; how to localize.

### Act 4 — Diencephalon
- **Thalamus:** the nuclei (VPL, VPM, LGN, MGN, VA, VL, DM, pulvinar, anterior,
  intralaminar) and their cortical connections — the relay logic.
- **Hypothalamus:** nuclei and functions; the pituitary axis.
- Epithalamus (pineal, habenula); subthalamus (subthalamic nucleus).
- **Internal capsule:** limbs and their contents — the bridge to the cerebrum.
- Blood supply (thalamoperforators, thalamogeniculate); thalamic pain syndrome
  (Déjerine-Roussy).

### Act 5 — Cerebrum
- Lobes; major gyri and sulci; functional cortical areas — motor & sensory
  homunculus, Broca, Wernicke, primary visual/auditory.
- White matter: association fibers (arcuate/SLF, uncinate, cingulum),
  commissural (corpus callosum, anterior commissure), projection fibers.
- **Basal ganglia:** caudate, putamen, globus pallidus (int/ext), subthalamic
  nucleus, substantia nigra; the **direct / indirect / hyperdirect** pathways.
- Ventricular system and CSF circulation; meninges; venous sinuses.
- **Vascular:** circle of Willis; ACA / MCA / PCA territories and syndromes;
  watershed zones; lenticulostriate lacunes.
- **Clinical:** cortical localization; the aphasias; the visual-field defects;
  ACA vs MCA vs PCA strokes; capsular lacunar syndromes.

### Act 6 — Systems & Integration *(hardest — the payoff)*
Not new regions — the *whole pathways*, end to end, and cases that cross levels.
- Complete sensory pathways: pain/temperature, fine touch & vibration,
  proprioception — from receptor to cortex, with every relay and decussation.
- Complete motor pathways: pyramidal and extrapyramidal.
- Visual pathway retina → cortex, with the field-defect map for each lesion site.
- Auditory and vestibular pathways.
- Autonomic nervous system: sympathetic vs parasympathetic; Horner's syndrome.
- Limbic system and the Papez circuit; memory.
- **Grand-rounds bosses:** vignettes that require localizing across multiple
  levels at once — the exam-day skill.

---

## 3. The game modes (the lenses)

All read the shared dataset. All feed one progression/XP/mastery system.

1. **Atlas — spatial identification.** Clickable schematic cross-sections and
   views. Two directions: *name → click the structure*, and *click → name it*.
   Drag-to-place variants for the Kinesthete. This is rung 1 (Locate) and the
   most-used early mode.

2. **Cases — lesion detective.** A short clinical vignette of deficits. The
   player localizes: level + side + structure/territory. The syndrome is then
   revealed and explained. This is rungs 4–5 and the Storyteller heart of the
   game. Built from the vascular + tract + syndrome data.

3. **Drill — quiz + spaced repetition.** An adaptive question bank. Cards are
   generated from the content model (function↔structure, tract origin/
   decussation/destination, CN-nucleus level, blood supply) plus hand-authored
   hard cards. **SM-2 spaced repetition** persisted in IndexedDB drives a daily
   "due" queue — this is the mechanism that turns short-term cramming into
   long-term retention. This mode is why the player still knows it in six months.

4. **Time Attack — timed mastery.** Rapid-fire rounds on already-learned
   material. Combo multipliers, lives, personal best, a "ghost" of your previous
   run. Self-competition (Deepak's secondary play type). Only unlocks material
   the player has already reached rung 3+ on — it's a mastery mode, not a
   teaching mode.

5. **Ride the Tract — signature connectivity mode.** A signal starts at a
   receptor (or cortex, for motor). The player routes it: at each relay and each
   decussation they choose the correct next stop. Get the route right and the
   signal completes; get it wrong and you see *where the deficit would appear*.
   This is the mode that makes connectivity *playable* rather than memorized. It
   is the thing that would make this game not-just-another-quiz.

---

## 4. Game dynamics (so it's actually fun, not a flashcard deck)

- **Journey map / skill tree.** The neuraxis drawn as a map you travel upward.
  Nodes unlock as you master the one below. Visible progress; a clear "next."
- **Two mastery signals per region:** a *learned* bar (have you climbed the Bloom
  ladder) and a *retained* bar (is SRS keeping it green). Both must stay up.
- **XP and levels**, per-region and overall.
- **Streaks:** a daily streak (did your SRS queue today) and in-round combo
  streaks (Time Attack).
- **Boss encounters** at the end of each Act — integrated cases that gate the
  next Act. This is where difficulty spikes on purpose.
- **Achievements / badges:** "Decussation Master," "Survived Wallenberg,"
  "Named all twelve," "Thirty-day streak." Storyteller-flavored, never
  cheerleading.
- **Ghosts and personal bests** — you compete against your past self, not others.
- **Calm, exact copy.** Per the project voice: *scene, chapter, move, relay* —
  not *task, level up!, you crushed it*. No exclamation points outside narrative
  content. No emoji. The tone is a good attending, not a wellness app.

The fun is not confetti. The fun is the *click* of a system resolving — when the
player realizes a deficit, a decussation level, and a blood-supply territory are
three views of one fact. The dynamics exist to keep them returning to that click.

---

## 5. Accuracy strategy ("very accurate")

This is being built for a neurologist. Wrong is worse than absent.

- **Typed, complete records.** TypeScript types force every tract to specify
  origin, decussation, destination, function, and lesion effect. Nothing is
  half-specified.
- **Every content record carries a `reviewStatus`** (`draft` / `verified`) and
  an optional `note`. Anything I author but am not fully certain of ships as
  `draft` and is surfaced in a **content-review screen** so Deepak can verify or
  correct it — the domain expert is in the loop by design, not by accident.
- **Sources.** Core anatomy is textbook-stable; where a fact is genuinely
  contestable or level-of-detail-dependent (e.g., exact laminar destinations,
  minor vascular variants), the record notes it rather than asserting false
  precision. PubMed is available for anything genuinely current/edge.
- **No fabricated diagrams.** Diagrams are schematic (see §6) — they claim to be
  schematics, so they can't mislead the way a wrong "realistic" plate would.

---

## 6. Diagrams — the honest tradeoff

Diagrams are **hand-authored schematic SVGs**: topologically correct, labeled,
and clickable — a butterfly of spinal gray matter with the tracts in their real
relative positions, a medulla with the pyramids and olives and CN nuclei placed
correctly, a mid-sagittal brain, a coronal at the basal ganglia.

**Stated plainly:** these are *not* photorealistic atlas plates (Netter/Gray's).
For a *localization learning game* that is the correct choice — schematics are
clearer, they isolate the teaching point, and they can be made interactive. But
it means the game will not look like a photographic atlas, and it is not a
substitute for one when studying surface morphology. If photoreal interactivity
is wanted later, that is a separate and much larger effort (licensed imagery or
a lot of illustration work).

---

## 7. Technical architecture

Kept close to what's already known and proven here — Vite + React + TS + Tailwind
+ Dexie + `vite-plugin-pwa` — because it's a genuinely good fit (offline-first,
installable on the S25 Ultra, no backend to run) and it's the stack Deepak
already has. Freed from the *old file structure*, but not switching frameworks
for novelty's sake.

```
src/
  content/        the neuroanatomy dataset — the crown jewels
    structures.ts       nuclei, gyri, columns, regions…
    tracts.ts           origin/decussation/destination/function/lesion
    vascular.ts         arteries → territories → deficits
    sections.ts         cross-section definitions + SVG hotspot maps
    syndromes.ts        clinical syndromes → localization
    curriculum.ts       Acts → Chapters → which content + which modes
    questions.ts        hand-authored hard cards (generated ones come from engine)
  engine/
    srs.ts              SM-2 scheduling
    progression.ts      XP, mastery, unlock gating
    questionGen.ts      derive cards from the content model
    scoring.ts          Time Attack scoring, combos, ghosts
  db/                   Dexie schema: progress, srsCards, stats, achievements, settings
  diagrams/            one clickable SVG component per cross-section/view
  modes/               Atlas, Cases, Drill, TimeAttack, RideTheTract
  ui/                  app shell, journey map, shared components
```

- **Persistence:** IndexedDB via Dexie — SRS cards, per-structure mastery, stats,
  achievements, settings. Fully offline.
- **PWA:** installable, offline-capable, `base: '/Play/'` retained for GitHub
  Pages (deploys from `main`; this branch won't auto-deploy until merged).
- **The existing PlayDHD source** is set aside (recoverable in git history), per
  the decision to make the anatomy game this branch's app.

---

## 8. Delivery plan (incremental — Deepak's 60–90-min sessions)

Major change, built in vertical, testable slices. Each increment is a playable
step, not a big-bang.

1. **Foundation** — repo restructure, the typed content model + DB schema, app
   shell + empty journey map. *(no anatomy content yet — proves the skeleton)*
2. **Act 1 content** — spinal cord authored fully in the typed model, with
   `reviewStatus` flags and the content-review screen.
3. **Drill mode** on Act 1 — the first complete play loop (quiz + SRS + XP).
4. **Atlas mode** — spinal cord clickable cross-section.
5. **Cases mode** — the cord syndromes as lesion-detective cases.
6. **Time Attack + Ride-the-Tract** on Act 1 content; achievements, streaks.
7. **Acts 2 → 6** — author content act by act; diagrams and cases expand. Each
   act is one or more focused sessions.

By the end of increment 6 there is a *complete, fun game on a full region* — the
proof that the whole thing works — and 7 is "pour in the rest of the nervous
system," which the architecture makes additive rather than structural.

---

## 9. Open questions to settle before/near the start

- **Title.** "Neuraxis" is the working name. Alternatives welcome.
- **German.** English v1 (per project convention). German is a later candidate;
  the content model can hold `de` labels from the start if wanted — cheap now,
  expensive to retrofit. Worth a yes/no early.
- **Content-review depth.** How much does Deepak want to verify vs. trust? The
  `draft`/`verified` flag supports either.
- **Scope realism.** Acts 0–6 in full detail is a large body of authored content.
  The architecture is the fast part; the *neuroanatomy authoring* is the long
  pole. This is worth naming honestly up front.
```
