# Telestroke — Plan (v0, for review)

*A low-bandwidth video consultation between a field team (ambulance, Notarzt,
rural clinic) and a hub stroke neurologist, with a shared structured panel:
FAST-ED, GFAP, systolic BP, age, headache.*

Status: **plan only. No code exists.** Every decision marked **[DECIDE]** needs
Deepak's answer before the matching build step starts.

Change class: **MAJOR** — a new application with its own networking layer and a
hosted server. It lives in its own folder (`telestroke/`) so Head-in is untouched.

> Research prototype. Not a medical device, not for clinical decisions. Decision
> support of this kind falls under EU MDR (likely Class IIa or higher) before any
> clinical use. The app shows this banner on every screen.

---

## 1. Scope of the first slice

In:

- Two roles in one app: **Field** (starts the case, enters data, sends video) and
  **Hub** (sees video and panel, scores independently).
- **Structured panel**, entered on the Field side, mirrored live to Hub:
  - GFAP (pg/mL; the assay or device name is recorded with it, because cutoffs
    are assay-specific)
  - Systolic BP (mmHg)
  - Age (years)
  - Headache: `yes` / `no` / `unobtainable` (for example, aphasic or reduced
    consciousness)
  - FAST-ED (§3), scored on both sides, shown side by side
- **Tiered transport** (§4): the call degrades level by level, never all at once.
- A hosted signaling and relay server (§5).

Out (for now):

- **Any computed risk score from GFAP + BP + age + headache.** The first slice
  shows raw values only. A score gets built only from a validated formula Deepak
  supplies (coefficients, cutoffs, assay, source). No invented numbers. **[DECIDE]**
  whether a formula exists to implement.
- Recording, patient identifiers, persistence. Nothing is stored server-side, and
  the field device keeps the case only in memory for the length of the call.
- Login and accounts. Rooms are joined with a short-lived code (§5). This is
  adequate for a demo and **not** for production.
- German UI (later, same pattern as Head-in: labels stored as `{ en, de? }`).

## 2. Screens

**Field**
1. *Start case* → creates a room and shows a 6-digit code plus a link to send to
   the hub.
2. *Case screen*: own camera preview (small), connection-level indicator, the
   structured panel, FAST-ED form, *Send still* button (level 2).

**Hub**
1. *Join* → enter the code or open the link.
2. *Case screen*: remote video (large), the panel (read-only), its own FAST-ED
   form, side-by-side comparison, *Request still: face / arms / eyes*.

Both sides: a 24-hour clock showing time since the case started (the clinical
"door" time is entered manually; the app doesn't guess symptom onset).

## 3. FAST-ED

Field Assessment Stroke Triage for Emergency Destination (Lima et al., *Stroke*
2016). Implemented as published, and shipped as `reviewStatus: draft` for Deepak
to verify each item's wording before it counts as `verified`:

| Item | 0 | 1 | 2 |
|---|---|---|---|
| **F**acial palsy | normal or minor paralysis | partial or complete paralysis | — |
| **A**rm weakness | no drift | drift, or some effort against gravity | no effort against gravity, or no movement |
| **S**peech changes | absent | mild to moderate | severe, global aphasia, or mute |
| **E**ye deviation | absent | partial | forced deviation |
| **D**enial / neglect | absent | extinction to bilateral simultaneous stimulation in one sensory modality | does not recognise own hand, or orients only to one side |

Total 0–9. The UI shows **"≥4: LVO more likely (consider thrombectomy-capable
centre)"** as a reference line, not a recommendation.

Honest limits:
- **Eye deviation and neglect are the items most likely to be misjudged over
  low-resolution video.** The Hub form marks them "assessed by: video / still /
  field report" so the source is explicit.
- At level 0 (no media), Hub can't score at all. It sees the Field score labelled
  as such.

## 4. Tiered transport

The core idea: **the structured data is the payload that must always arrive.
Video is a bonus.**

| Level | Adds | Target rate | Notes |
|---|---|---|---|
| 0 | Panel + FAST-ED over a WebRTC data channel | < 1 KB per update | Still works when voice won't |
| 1 | Voice (Opus, mono, ~8 kbps, FEC on) | ~8–12 kbps | Speech assessment possible |
| 2 | On-demand stills: face, both arms, eyes | ~5–15 KB each (WebP, 320×240) | Pluggable codec slot; H-DDCM later, clinic-only, after validation (§6.4) |
| 3 | Live video 160×120 → 320×240, 8–15 fps | ~40–150 kbps | VP8/VP9/H.264, whichever the device encodes in hardware |

All rates are **estimates from codec specs, not measurements**. Step 4 of the build
(§8) measures them on throttled links.

Adaptation: every 2 s, read `RTCPeerConnection.getStats()` (available outgoing
bitrate, packet loss, round-trip time). Step down after ~4 s of bad readings,
step up only after ~15 s of good ones. The asymmetry (hysteresis) stops the call
from flapping between levels. Either side can **pin** a level manually, for
example to force voice-only.

## 5. Server (signaling and relay)

WebRTC needs two things GitHub Pages can't provide:
- **Signaling:** a tiny service that lets the two devices exchange connection
  details. It carries no video and no patient data.
- **TURN relay:** forwards media when mobile carrier networks block direct
  connections, which is common on 4G/5G. It relays **encrypted** packets
  (DTLS-SRTP) and can't read them.

The panel data goes over the WebRTC data channel, which is end-to-end encrypted
between the two devices. It never touches the signaling server.

Options **[DECIDE]**, both of which need an account Deepak creates:

| | A. Cloudflare Workers + Durable Objects + Cloudflare TURN (recommended) | B. Fly.io (Frankfurt) small Node server + coturn |
|---|---|---|
| Setup effort | Lowest; no machines to manage | More: a VM-like app plus coturn config |
| Cost at prototype scale | Likely free tier for signaling; TURN billed per GB | Small monthly cost for an always-on machine |
| Data location | Global edge; metadata may be processed outside the EU | Can pin to Frankfurt |
| What the server sees | IP addresses, timing, room codes. No content | Same |

The tradeoff, named: A is simpler. B gives a cleaner GDPR story because of EU
pinning. For a demo with no real patients, A is enough. For any pilot, revisit
toward B or a hospital-hosted server.

Room codes: 6 digits, single-use, expire after 10 minutes unjoined, and the room
closes when either side leaves. Guessable in principle, which is acceptable only
because nothing sensitive flows through signaling.

## 6. H-DDCM

Source: Ronai, Kulikov, Michaeli (Technion), *H-DDCM: Hadamard Codebooks for
Fast Generative Image and Video Compression*, arXiv 2610.18125v1 (13 Oct 2026),
read from the Markdown conversion Deepak supplied. The figures weren't included,
so numbers that appear only in plots (notably video encode/decode FPS) are
**not** quoted here. Anything marked *(inferred)* is my reasoning, not the
paper's.

### 6.1 What it is, in one paragraph

A pretrained image or video generator (a diffusion or flow model) is kept frozen.
Instead of feeding it random noise at each generation step, the sender chooses
noise that steers the output toward the real image, and transmits only *which*
noise it chose: a few hundred indices per step. The receiver runs the same model
with the same seed and the same chosen noise, and regenerates the image. DDCM
picked from a stored random (Gaussian) codebook, and Turbo-DDCM combined several
atoms per step. H-DDCM replaces the stored codebook with a **randomized Hadamard
transform**, which is generated on the fly from the seed, exactly orthogonal, and
fast (O(d log d)). That removes the 128–167 GiB codebooks that otherwise make
large image and video models impractical.

### 6.2 Numbers the paper reports

| Setting | Backbone / resolution | Rate | Time | Hardware |
|---|---|---|---|---|
| Image | SD 2.1, 512×512, 30 steps | 0.027 bpp ≈ **7,100 bits ≈ 0.9 KB per image** | **1.3 s round trip** (encode + decode) | NVIDIA A6000 |
| Image | FLUX, 1024×1024, 30 steps | swept | **44 s round trip** (Turbo-DDCM: 66 s) | NVIDIA A6000 |
| Video | Causal-Forcing (CF), **832×480 fixed**, 4 consistency steps, chunks of 3 latent frames | swept ~10⁻³–10⁻² bpp; examples at 0.01 bpp ≈ **4,000 bits ≈ 0.5 KB per frame** | "close to real-time"; FPS only in figures | **NVIDIA H200** |

The per-image and per-frame byte figures are my arithmetic from bpp ×
resolution. Converting to kbps needs the video frame rate, which the text doesn't
give.

How it compares: on video, HEVC, VVC and DCVC-UF achieve **higher PSNR** (more
pixel-accurate) but weaker *perceptual* scores (DOVER, FVMD). H-DDCM wins on
"looks right," not on "is pixel-exact."

### 6.3 What this means for telestroke

1. **The encoder needs a GPU on the sending side.** Encoding *runs the
   generative model* at every step to compute the residual (Alg. H). So compression
   happens where the camera is (ambulance or clinic), on A6000- or H200-class
   hardware. A phone can't do it, and a server can't do it for the field device
   without first receiving the uncompressed video over the very link we're trying
   to spare. *(Inferred from the algorithm; the paper doesn't discuss edge
   devices.)*
2. **Both ends need the identical model weights, seed and sampler.** The decoder
   regenerates the encoder's trajectory exactly. *(Inferred risk:)* small
   floating-point differences between GPU models or driver versions could make the
   trajectories diverge. The paper doesn't test cross-hardware decoding, so this
   needs its own test before trusting it.
3. **Optimised for plausibility, not fidelity.** The paper says it outright:
   "reconstructing perceptually plausible content can be preferable to preserving
   every pixel accurately." For stroke assessment the opposite is true. A facial
   droop, a gaze deviation or a pronator drift is exactly the kind of fine,
   patient-specific detail a generative prior can smooth away or invent. The
   evaluation sets (Kodak, DIV2K, CLIC, UVG, MCL-JCV, HEVC classes) are general
   scenes. **There is no face-specific or clinical evaluation.** The ethics
   statement itself warns outputs "could be misinterpreted or misused in sensitive
   applications."
4. **No released code is mentioned.** The reproducibility statement says results
   can be reproduced "by implementing the method" from the pseudo-code and
   appendices, and there's a project site (h-ddcm.github.io). Backbone licences
   (SD 2.1, FLUX, CF) must be checked before any use. *(Inferred:)* some FLUX
   variants are non-commercial.

### 6.4 Placement decision (proposed)

| Scenario | H-DDCM fit |
|---|---|
| Ambulance → hub, live video | **Not in scope.** Needs an H200-class GPU in the vehicle. Keep conventional codecs (level 3). |
| Ambulance → hub, stills | **Not in scope** for the same reason (A6000-class GPU on board). |
| Rural clinic with a GPU workstation → hub, stills | **Plausible later.** ~0.9 KB per 512×512 still in ~1.3 s, versus ~5–15 KB for WebP. Worth it only on links where 10 KB is genuinely too much. |
| Any scenario | **Gated on §6.5.** No clinical use of reconstructions until they're shown to preserve FAST-ED signs. |

So the app ships v1 **without** H-DDCM, and leaves a codec interface at level 2
(`encodeStill(image) → bytes`, `decodeStill(bytes) → image`) so an H-DDCM
implementation can plug in without touching the call logic.

Whatever codec fills that slot, these rules hold:
- any generative reconstruction is labelled **"AI-reconstructed"** on the Hub
  screen, never silently
- a one-tap **"send conventional still"** fallback (WebP) is always available
- a reconstruction is never the sole basis for a FAST-ED item; the item's
  "assessed by" field records it.

### 6.5 The validation question H-DDCM needs first (bench study, no patients)

*Does an H-DDCM reconstruction preserve the signs a neurologist scores?* Proposed
design:
- **Inputs:** face and upper-body images with and without facial palsy, gaze
  deviation and arm drift, from public datasets with suitable licences (to be
  identified) or staged recordings of consenting volunteers.
- **Arms:** original vs WebP at a matched byte budget vs H-DDCM at 1–2 bitrates.
- **Readers:** blinded neurologists score the F, A and E items of FAST-ED.
- **Outcome:** agreement with the original (weighted κ). Key failure counts:
  signs **erased** (false negatives) and signs **invented** (false positives).
- **Also test:** decoding on a different GPU model from the encoder (§6.3 point 2).

This is self-contained, needs no app, and could stand alone as a research
question. Whether it belongs in the thesis is Deepak's call.

## 7. Repository layout and deployment

```
telestroke/
  package.json        own dependencies; doesn't touch the root app
  vite.config.ts      base: '/Play/telestroke/'
  src/
    roles/            Field, Hub screens
    panel/            structured panel + FAST-ED (typed, Zod-validated input ranges)
    transport/        peer connection, levels, getStats adaptation
    signaling/        client for the hosted server
  server/             signaling worker (option A) or Node app (option B)
```

Stack (proposed, **[DECIDE]**): the same as Head-in (Vite + React + TypeScript +
Tailwind), no new frameworks. WebRTC is built into the browser, so no video SDK
is needed.

Input ranges (validated, out-of-range values flagged rather than silently
accepted): SBP 50–300 mmHg, age 0–120, GFAP ≥ 0.

Deployment: `.github/workflows/deploy.yml` currently builds only Head-in. Serving
`/Play/telestroke/` means changing that workflow to build both apps. That's a CI
change, so a separate **MODERATE** step with its own approval. Until then the app
runs locally only (`npm run dev` inside `telestroke/`). WebRTC needs HTTPS for
camera access, so phone testing waits for the deploy step.

## 8. Build steps (each about one 60–90 min session)

1. **Skeleton:** `telestroke/` app, both role screens, structured panel + FAST-ED
   form with validation. No networking. Local only.
2. **Signaling server** (after the hosting choice and account setup) + room codes.
3. **Level 0 + 1:** data channel sync of the panel, voice.
4. **Levels 2 + 3 + adaptation**, measured on throttled links (Chrome DevTools
   network throttling) with the real kbps recorded in this doc.
5. **Deploy** (workflow change, MODERATE, own approval).
6. **H-DDCM**: not an app step yet. First the bench validation (§6.5), which
   runs independently of the app and needs a GPU (A6000-class) plus an
   implementation from the paper's pseudo-code. App integration only if it passes.

## 9. Open decisions

- **[DECIDE]** Hosting: option A (Cloudflare) or B (Fly.io Frankfurt).
- **[DECIDE]** GFAP: raw values only, or a validated formula (please send source).
- **[DECIDE]** Stack: confirm the Head-in stack.
- **[DECIDE]** H-DDCM: agree to the §6.4 placement (v1 ships without it; clinic
  stills later, gated on the §6.5 bench study)? And is GPU access available
  (hospital, university cluster, cloud) for the bench study?
- Repo fit: `CLAUDE.md` describes this repo as the personal-layer app and says
  the stroke work lives elsewhere. Telestroke goes in its own folder here at
  Deepak's request. If it grows, moving it to its own repo later is a folder
  move with no code changes.

## Rollback

Everything sits in `docs/TELESTROKE_PLAN.md` and, later, `telestroke/`. To undo,
delete those paths, or `git revert <commit>` for any step.
