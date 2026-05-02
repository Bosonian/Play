# CLAUDE.md

Project-level context for Claude Code working on the PlayDHD App. Read this alongside `PLAYDHD_APP_BRIEF_v2.md`. The brief tells you *what* to build. This file tells you *who you're building it for* and *how he works*.

This file is mutable. The brief is not. If something here conflicts with the brief, the brief wins — but flag the conflict so it can be reconciled.

---

## Who Deepak is

Neurology resident in Stuttgart, Germany, working toward Facharzt qualification (board certification) by Q4 2026. Indian, originally from Kerala, now in Germany for several years. Lives with his partner Aparna; speaks Malayalam (mother tongue), Tamil, Hindi, English, and German (B2–C1). The five-language background matters: he code-switches naturally and his voice dictation occasionally produces hybrid-language artifacts.

He runs several parallel projects outside his clinical work — a medical AI tool for prehospital stroke triage, an online language school operated by his partner, a personal-safety wearable concept, a doctoral thesis. **None of these are what this app is for.** Those have their own systems. This app is for the personal layer that gets crowded out: piano practice, household admin, Facharzt prep, balcony time, the things he wants to do but doesn't.

He has self-identified ADHD patterns: motivation runs hot for novelty, urgency, and audience-bearing tasks; runs cold for slow-reward factual scaffolding. He's good at architecting logic and bad at remembering syntax. He uses voice dictation (Wispr Flow) for most text input, including clinical documentation. This means his text inputs into the app will frequently contain dictation artifacts — extra spaces, occasional homophone errors, sentence-end punctuation drift, mid-sentence language switches.

His play personality (frozen, see brief §2): primary Storyteller, secondary self-Competitor, tertiary Kinesthete. Director is a learned adult mode, not native — the app should not lean into it.

---

## How he works

A few patterns worth knowing because they shape what defaults make sense:

**He values being told the truth about tradeoffs over being reassured.** If a design choice has a downside, name it in a code comment or commit message. Do not say "this should work fine" when you mean "I think this works but I haven't tested edge case X." This applies to everything from architectural choices to copy decisions.

**He architects logic well but isn't fluent in syntax.** Write code that's readable. Favour clarity over cleverness. Comment the *why* of unusual choices, not the *what*. If you use a pattern that would be unfamiliar to someone with intent-level rather than syntax-level coding fluency, briefly explain it in a comment.

**He's used to giving high-stakes presentations and writing dense scientific documents.** This means he reads carefully and notices imprecise language. UI copy should be exact, not approximate. *"Tasks ignored for 3+ days surface here"* is correct; *"old tasks show up here eventually"* is not.

**He has a `<userPreferences>` set of safety rules** in his Claude environment. The most relevant for this project:

- Always create a feature branch, never work directly on main/master
- Explain plans in plain English before executing
- Show diffs before applying changes
- Make incremental changes, not massive rewrites
- Classify changes as Minor / Moderate / Major and ask before proceeding on Moderate or Major
- Provide rollback instructions
- Never disable tests or validation without asking
- Use meaningful commit messages

These apply to this project. Honor them.

**He works in 60–90 minute focused windows, not 8-hour stretches.** When you're estimating build steps for him, calibrate to that. "This is one focused session" is more useful than "this should take 2 hours."

---

## Copy and default choices

When you have to make a judgment call on copy or defaults, here's how to call it:

**Language: English UI for v1.** German support is a v1.5 candidate. Don't try to support both in v1.

**Tone: calm, spare, exact.** No exclamation points except inside narrative content (e.g., a scene seed describing a child's game). No emojis. No "you've got this!" wellness-app voice. The brief calls this Storyteller-flavored — words like *scene, prop, move, chapter* in the appropriate UI labels, not *task, todo, productivity*.

**Time of day defaults: European, not American.** 24-hour time format. Week starts Monday, not Sunday — but Sunday Reflection stays Sunday because that's where it landed in the brief and shifting it would change semantics.

**Date format: ISO 8601 (YYYY-MM-DD) for storage; locale-appropriate for display.** Don't use US-style MM/DD/YYYY anywhere.

**Defaults that lean toward less, not more.** When unsure between two reasonable options, pick the smaller one. The user can ask for more; it's harder to ask for less without feeling like the app is giving up.

**Touch-driven, but keyboard-friendly.** The app will be used on the user's mobile (Samsung S25 Ultra — Android Chrome, install as PWA from the Chrome menu) and on Mac (browser). Keyboard shortcuts for capture (Enter to submit, Esc to clear) are good. Don't go further than that in v1.

---

## Note on the brief and platform

`PLAYDHD_APP_BRIEF_v2.md` was written assuming the user has an iPhone (mentioned in §4, §9 step 10, §13). He does not — he uses a Samsung S25 Ultra (Android Chrome). Treat the brief's literal-iPhone references as "his mobile device." Architecture is unchanged (PWA + IndexedDB works identically on both). What differs: install instructions (Chrome menu → Install app, not Safari Share → Add to Home Screen), some PWA-platform quirks (safe-area-insets, theme-color application), and web push feasibility (much easier on Android — already noted in TODO.md's v1.5 entry for the Sunday Reflection nudge).

Deployment: GitHub Pages from `main` via Actions workflow. Live URL: `https://bosonian.github.io/Play/`. Subpath hosting means Vite's `base: '/Play/'` and the PWA manifest's `start_url: '/Play/'` are load-bearing — don't remove them without changing the deploy target.

---

## Things to ask vs. things to assume

**Always ask before:**

- Choosing a tech stack (the brief says you decide; ask once at the start, get explicit approval)
- Adding any feature not in §9 of the brief
- Modifying the seed pool content in §7 of the brief beyond minor cleanup
- Using a third-party service that requires an account or API key
- Anything classified as Moderate or Major per his safety preferences

**Safe to assume:**

- Specific styling choices within the calm/spare brief
- Internal code organization and file structure
- Variable and function naming conventions (clear over clever)
- Choice of utility libraries for routine things (date handling, UUID generation, IndexedDB wrappers)
- The reframe templates in §7.3 can be improved with better keyword matching as you encounter real task titles during testing

**Worth flagging (as a question, not a decision):**

- If you notice the brief contradicts itself somewhere, flag it
- If you find a §11 anti-pattern that he's *de facto* asking for via natural use during testing, flag it — don't silently violate the anti-pattern, but don't dismiss the signal either
- If during use, the seed pool feels generic and you can suggest more personal entries based on conversation, flag it as a v1.5 candidate

---

## One thing to remember

The app is not the product. The product is Deepak playing piano on the balcony with the door open. The app is a small piece of scaffolding that helps that happen, and the scaffolding works to the extent that it disappears.

Build accordingly.
