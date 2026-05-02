# PlayDHD App — Build Brief (v2)

This document supersedes any prior version. If you have an earlier `PLAYDHD_APP_BRIEF.md`, archive it. This is the build brief.

Read end-to-end before scaffolding anything.

---

## 1. The premise this app is built on

Most productivity apps assume the user has tasks they want to do and need help organizing. **This app assumes the opposite.** The user has a life rich with stakes and obligations and projects, and what's missing is play that doesn't have to justify itself. The app exists to **make play happen**, not to make tasks easier.

Tasks are handled, but as a side effect.

This premise is non-negotiable. If during the build you find yourself adding features that optimize task throughput at the expense of play, stop and re-read this section.

---

## 2. The user

Deepak. Neurology resident in Stuttgart, Germany. Self-identified ADHD patterns: motivation runs hot for novelty/urgency/audience, dies for slow-reward factual scaffolding. Voice-dictates extensively (Wispr Flow). Architects logic well, isn't fluent in code syntax. Lives with his partner Aparna in Stuttgart; has a southwest-facing balcony, plays piano (beginner, self-taught), rides a 125cc motorcycle, has Kerala cultural roots, speaks five languages.

His professional life is high-stakes and runs on multiple parallel tracks (a medical AI tool called iGFAP, an online language school, a personal-safety wearable, a doctoral thesis, board exam prep, ED clinical shifts). All of these have their own systems already. **This app is not for those.** This app is for the personal layer underneath: the piano, the balcony, the boring household tasks, the Facharzt prep that gets neglected, the play that gets crowded out.

His play personality, established via the Way-Back Play Machine assessment in chat:

- **Primary: Storyteller** — narrative-wrapped solo play
- **Secondary: self-Competitor** — flow state via challenge-vs-self
- **Tertiary: Kinesthete in service of the other two**

Important: Director is a *learned adult mode* for him, not native. His professional life is full of Director-mode play (running iGFAP, managing Plan Beta, coordinating multicentre studies). The app should NOT lean into Director framing — that's exactly the mode his life already overserves. The app's job is to make space for the modes his life *underserves*.

---

## 3. What this app does and doesn't do

### Does

- Protect time for play that doesn't have to justify itself
- Suggest small environmental shifts (Outside-In) when state needs changing
- Capture tasks at near-zero friction so they stop occupying working memory
- Reframe avoided tasks using non-native personality modes (see §5.3) when capture-and-defer isn't working
- Reflect: a weekly Sunday prompt that asks two questions and stores the answer

### Doesn't

- Track productivity, hours, completion rates, or any throughput metric
- Calculate streaks, badges, achievements, or levels
- Award points, currency, or any quantified reward for completing tasks
- Replace or duplicate Google Calendar
- Send notifications by default (one optional Sunday reflection nudge; that's it)
- Synchronize with anything (no cloud, no sharing, no backup-to-server)
- Have a multi-user mode, an account, or a login
- Have an analytics dashboard, ever

The "doesn't" list is load-bearing. Each item there is a feature-creep vector that ADHD productivity apps reliably fall into.

---

## 4. The architecture in one paragraph

A single-screen web app, installable as a PWA on iPhone home screen. The screen has three sections stacked vertically: **Today's Scene** at the top (one prop suggestion, one prompt), **Capture** in the middle (single text input, near-zero friction), and **What's been sitting** at the bottom (tasks captured but ignored for 3+ days, with reframe options). A separate route, accessed weekly, is the **Sunday Reflection**. That's the whole app. There is no calendar tab, no rewards catalog, no playlist menu, no points balance, no habit loop card, no streaks, no progress bars. Build this and stop.

---

## 5. The three mechanisms

These are the only mechanisms in v1. Each is described below in enough detail to implement.

### 5.1 Today's Scene — the play protection layer

Every day, the app opens to a single suggestion. It looks like this:

> **Today's prop: the brown hat from Mallorca.**
>
> **Today's scene: 20 minutes on the balcony, no phone, just listening.**
>
> *Already did this? ✓     Skip today ✗     Show me a different one ↻*

The prop and the scene rotate from a small seed list (you'll write the seeds in §7). Each day the app presents one prop and one scene. The user can ✓ it (logged with a date, no further commentary required), ✗ it (logged but no shame), or ↻ for a different one (offers an alternative from the same seed pool).

There is no streak. There is no "you've done it 3 days in a row!" There's just today's suggestion, today's outcome, and the seed pool keeps going.

The rotation algorithm is deliberately stupid: pick a random unseen-this-week scene and a random unseen-this-week prop. Don't optimize this. Stupid is correct here.

When the user taps ✓, the app briefly shows ***"Phone down. Go."*** for 2 seconds, then auto-dismisses to a calm empty state. See §10 for the rationale on these phone-down prompts — they are non-decorative.

The seed pool is editable from a Settings screen but not from the main view. The user shouldn't be tweaking the seed pool when they should be on the balcony.

### 5.2 Capture — the friction-zero task inbox

A single text input at the middle of the screen. The user types or dictates a task in one line. Hits Enter. The task disappears from view (it's logged, but not surfaced). That's the entire interaction.

> *What's on your mind?*
>
> [____________________________] (Enter)

No category. No mode. No priority. No date. No tags. No project. No "is this a quick scene, recurring move, or training arc?" prompt. **The capture is the whole interaction.** Optimization happens later, only for tasks that need it.

The task gets stored with: id, title (the text), createdAt timestamp, lastReframedAt (null), status (pending). That's it.

Why this matters: ADHD capture-friction is real and well-documented. The gap between "thought of a task" and "task in system" needs to be sub-3-seconds or the task doesn't enter. The brief I'm writing replaces the previous brief's three-mode decision tree at capture with a single text field. That tree was a mistake.

### 5.3 What's been sitting — the reframe surface

Tasks captured but unfinished after **3 days** appear in a small section at the bottom of the screen. Not all of them — at most three, the oldest. The rest stay in the inbox, invisible.

For each surfaced task, the user has four buttons:

- **Done** — mark it complete, no further action. Logs completedAt timestamp.
- **Drop it** — mark it abandoned. Logs abandonedAt. The app doesn't ask why. Some things should be dropped; that's a feature, not a failure.
- **Reframe** — opens the reframe flow (described next).
- **Snooze 3 days** — bumps the surfacing timer. Limited: a task can only be snoozed twice before it must be reframed, dropped, or done.

**The reframe flow** is the heart of the boring-task tolerance mechanism. It uses the inverted personality principle: native personality for things you like, **non-native personality for things you don't**.

The flow is one screen, **four options of equal visual weight**. This visual equality matters: a task sitting for 3+ days is sometimes a signal that it doesn't need to be done at all, and the UI should make releasing the task as easy as reframing it.

> **You've been avoiding: "Reply to Grassmann about endpoint precision"**
>
> What now?
>
> **▸ Make it silly** *(Joker mode — strip dignity from the task)*
> Example: *"Write the first draft of this email as if you were explaining it to a confused dog."*
>
> **▸ Make it embodied** *(Kinesthete mode — change the body, change the brain)*
> Example: *"Walk to the balcony with your phone. Dictate the email pacing back and forth. Don't sit down."*
>
> **▸ Make it tiny** *(90-second mode — lower the activation barrier)*
> Example: *"Open the email draft and write only the greeting. That's the whole task. Stop after."*
>
> **▸ Drop it** *(release mode — some things don't need doing)*
> Marks the task abandoned. No questions asked. No "are you sure?" dialog.

The four options are visually equal — same button size, same prominence, same color treatment. Drop is not the small-text afterthought below the reframes; it's a peer to them. If the user picks one of the three reframe modes, the reframe text becomes the new task title, the original is preserved as `originalTitle`, and `reframedAs` is set. If the user picks Drop, the task is marked abandoned immediately.

(Note that Drop also exists as a top-level button on the surfaced-task view above. This is intentional duplication, not redundancy: the top-level Drop is for tasks the user already knows they don't want to do; the in-reframe Drop is for tasks the user only realizes they want to release once they're considering reframes. Two valid paths to the same action.)

The Joker and Kinesthete suggestions are pre-written for common task patterns (emails, reading, reviewing notes, replying to messages, cleaning, exercise) and selected by simple keyword matching against the task title. If no pattern matches, the app falls back to a generic version of each:

- *Joker generic:* "Approach this task as if you were narrating it to someone who finds it ridiculous."
- *Kinesthete generic:* "Stand up. Move to a different room. Do this task there."
- *90-second generic:* "Set a timer for 90 seconds. Do as much as you can. Stop when it rings, even mid-sentence."

This is the part of the app that does the actual work for the Facharzt problem. The Storyteller-Competitor brain colonizes any narrative-rich task and procrastinates on dry ones. Joker and Kinesthete framings bypass the colonization.

### 5.4 Sunday Reflection — the weekly closure

Once a week, on Sunday evening (default 19:00 local; user-configurable), the app surfaces a single dialog:

> **Two questions:**
>
> **1. What did you notice playfully this week?**
> [_____________________________________]
>
> **2. What's one scene you'd be glad to live next week?**
> [_____________________________________]
>
> *Save     Skip this week*

That's it. The answers are stored as a weekly journal entry, surfaced nowhere else by default. There's a tiny "see past reflections" link that opens a chronological list of past entries — useful but not loud. The journal accumulates evidence over months. That evidence is its own reward, and is not points.

Question 1 is deliberately open-ended and observation-based, not a yes/no audit. *"Did you play this week?"* invites self-judgment and triggers the same internal monitor that "did you exercise?" or "did you eat well?" triggers. *"What did you notice playfully?"* can't fail to answer — even a hard week has small moments of noticing, and the question makes them visible. This phrasing is non-negotiable: do not "improve" it back into a closed question.

No analytics on the journal. No "you said X four weeks in a row." The journal is a record, not a judgment.

If the user skips three Sunday Reflections in a row, the next time they open the app, a single one-liner appears at the top of the Today screen: *"You've skipped reflection three Sundays running. That's data — not a problem."* Nothing else. No nag, no prompt, no button. Just the observation.

---

## 6. What's NOT in v1 (and why each absence matters)

These were in the previous brief. They're cut.

- **Calendar tab.** You have Google Calendar. A parallel calendar will diverge from it within a week and you'll trust neither. The dessert-first principle is implemented as the Sunday Reflection's question 2, not as a UI surface to maintain.

- **Points / runs economy.** Currency-based reward for completing tasks is a Skinner-box mechanism. It's exactly the work-then-play model the book is supposed to overturn. Removed entirely.

- **Rewards catalog with redemption.** Same reason. Play that has to be earned isn't play. Play that's protected is play.

- **Habit loop cards with Cue/Routine/Reward.** This was a good idea applied to too many things. The Today's Scene mechanism *is* a habit loop — the cue is opening the app, the routine is doing the suggested scene, the reward is the scene itself. Don't try to formalize this for arbitrary tasks; it'll just become another thing to fill out.

- **Three-mode classification at task creation.** Capture is one text field. Modes only appear during reframe, only for tasks that have been ignored.

- **Onboarding screens.** Cut. The personality is frozen (§2). The app should work on first open with no setup. The seed pool ships pre-populated with §7 below.

- **Crisis Week / Calm Week toggle.** Cut. There's no enforcement to bypass, so no override needed. Your default state is high-load; the app respects this by not lecturing.

- **Alarm sound rotation.** Cut along with habit loops.

- **Streaks, badges, achievements, levels, progress bars, completion percentages, productivity scores.** Cut. All of these convert play back into work.

If during build you reach for any of these, stop and re-read §1.

---

## 7. Seed content (ships pre-populated)

The Today's Scene rotation pulls from these seed pools. Stored as a JSON or seeded into the DB on first launch. The user can edit them in Settings, but they should never be empty.

### 7.1 Props seed (small, personal, physical)

Write 12–15 of these. Examples calibrated to Deepak:

- The brown hat from Mallorca
- The 125cc motorcycle key (just hold it)
- The kitchen window with the dry-erase marker
- A specific piano piece, even if badly played
- The Wispr Flow voice button held for 30 seconds of nonsense
- A Malayalam song from your childhood, played out loud
- The southwest balcony at any time
- A coffee made the slow way, not the fast way
- One of Aparna's plants — water it without checking your phone
- A blank page and a pen, no goal
- The shower with the bathroom door wide open
- A specific piece of clothing you save for "special"
- The Stuttgart hat shop on Königstraße — go look, don't buy
- The bicycle if it's not raining
- A book in any language, opened to any page

The user will edit these. That's fine. Ship sensible defaults.

### 7.2 Scenes seed (small, time-bounded, low commitment)

Write 15–20 of these:

- 20 minutes on the balcony, no phone, just listening
- Walk one full lap around the block and notice everything purple
- Five minutes at the piano. No goal. Stop when bored.
- Read one page of a book in a language that's not English or German
- Step outside and look up for 60 seconds
- Cook one thing that takes only one pan
- Send Aparna one playful message with no context
- Find one object in the house that hasn't moved in a year. Move it.
- Lie on the floor for 5 minutes, no phone
- Voice-dictate a paragraph about anything that's not work
- Walk to the closest patch of grass and stand on it
- Open one of your "Hand and the Fluid" notebooks. Read one entry. Don't add to it.
- Make a cup of chai the proper way
- Take a single photograph of something boring
- 15 minutes of piano with a book or score you've never opened
- Write one paragraph about one childhood Kerala memory
- Do nothing, deliberately, for 10 minutes
- Look at exactly one painting online (any painter, any era)
- Sit on the balcony and identify three sounds
- Touch a leaf, a stone, and a piece of fabric. Notice the differences.

These are all under 30 minutes, all phone-optional, all one-step. The user will discover which ones land and edit accordingly.

### 7.3 Reframe templates (Joker / Kinesthete / 90-second)

These are keyword-matched against task titles in §5.3's reframe flow. Implement as a simple lookup table.

**Email-shaped tasks** (title contains "email", "reply", "respond", "message"):
- *Joker:* "Write the first draft as if you were explaining it to your sister, in Malayalam, in the kitchen."
- *Kinesthete:* "Stand up. Walk to the balcony. Dictate the reply pacing back and forth."
- *90-second:* "Open the draft. Write only the greeting and one sentence. Stop after 90 seconds even if mid-sentence."

**Reading/review-shaped tasks** (title contains "read", "review", "study", "Facharzt", "anatomy", "guideline"):
- *Joker:* "Read it out loud in the most ridiculous accent you can sustain. The sillier, the more memorable."
- *Kinesthete:* "Print one page. Take it to a different room. Read it standing up."
- *90-second:* "Open the document. Read one paragraph. Close it. That's the whole task."

**Cleaning/admin tasks** (title contains "clean", "tidy", "organize", "file", "sort", "submit", "form"):
- *Joker:* "Put on a song you'd never admit to liking. Do this for one song's length."
- *Kinesthete:* "Set a timer for 4 minutes and move continuously the whole time."
- *90-second:* "Do exactly one piece of this. The smallest piece. Stop after."

**Writing/work-shaped tasks** (title contains "write", "draft", "prepare", "plan"):
- *Joker:* "Dictate it badly. Use Wispr Flow. Don't correct anything. The errors are features."
- *Kinesthete:* "Walk while dictating. Don't sit down until the first paragraph exists."
- *90-second:* "Open a blank document. Type the first sentence. That's the task."

**Generic fallback** (no match): see §5.3.

---

## 8. Data model

Six entities. Implement in whatever the chosen stack prefers.

```
UserProfile (single row)
  id: string
  playPersonality: { primary, secondary, tertiary }   // frozen, see §2
  reflectionDayOfWeek: number  // default 0 (Sunday)
  reflectionTime: string       // default "19:00"
  consecutiveSkippedReflections: number
  createdAt: Date

Task
  id: string
  title: string                // current title (post-reframe if applicable)
  originalTitle: string?       // preserved if reframed
  reframedAs: "joker" | "kinesthete" | "ninety_second" | null
  status: "pending" | "complete" | "abandoned"
  createdAt: Date
  completedAt: Date?
  abandonedAt: Date?
  snoozeCount: number          // capped at 2
  lastSurfacedAt: Date?

DailyScene  (one row per day, even if skipped)
  id: string
  date: Date                   // unique
  propTitle: string
  sceneTitle: string
  outcome: "done" | "skipped" | "rotated" | "no_response"
  rotatedToProp: string?       // if user hit ↻
  rotatedToScene: string?

PropSeed
  id: string
  title: string
  active: boolean
  lastShownAt: Date?

SceneSeed
  id: string
  title: string
  active: boolean
  lastShownAt: Date?

WeeklyReflection
  id: string
  weekStartDate: Date          // unique (Monday of that week)
  didYouPlay: string
  nextWeekScene: string
  submittedAt: Date
```

That's the entire schema. Six tables. No `Reward`, no `HabitLoop`, no `PlayBlock`, no `BAP`, no `runsBalance`. The previous brief had 7 entities and a points system; this has 6 and no currency.

---

## 9. Build order

Ten steps, strict scope.

1. **Scaffold the project.** Pick a stack that supports PWA installation on iPhone home screen and persistent local storage. Vite + React + TypeScript + IndexedDB (via Dexie) is reasonable. SQLite via better-sqlite3 if going Node-side. No backend server.

2. **Data model.** Implement the six entities in §8. Seed PropSeed and SceneSeed tables on first launch from §7.1 and §7.2. Seed reframe templates from §7.3 (these can live in a static JSON file, no DB needed).

3. **Today's Scene (§5.1).** The default screen. Pull a prop and a scene from seeds, stupid-random algorithm, exclude items shown this week. Three buttons: ✓ ✗ ↻. Persist DailyScene record.

4. **Capture (§5.2).** Single text input below Today's Scene. Hit Enter, task is saved, input clears. No confirmation toast — confirmation is the input clearing.

5. **What's been sitting (§5.3).** Bottom section. Surface up to 3 tasks older than 3 days. Done / Drop / Reframe / Snooze buttons.

6. **Reframe flow.** When Reframe is tapped, open the three-option screen. Match keywords against task title to pick template. Apply user choice, update task title and `reframedAs` field.

7. **Sunday Reflection (§5.4).** Weekly dialog at configured time. Two questions, save WeeklyReflection. "See past reflections" link → simple chronological list view.

8. **Skipped-reflections observation.** One-liner at top of Today screen if `consecutiveSkippedReflections >= 3`. Nothing more.

9. **Settings screen.** Edit prop seeds, edit scene seeds, change reflection time. Reset all data button (with confirmation). That's all. No other settings.

10. **PWA manifest + iOS install instructions.** Standalone display mode, app icon, install prompt or readme.

**STOP HERE for v1.** Use the app for two weeks before adding anything. The book's repeated point: you find what works through doing, not through planning the perfect way to do.

---

## 10. UI principles

- **Calm.** White space, low color saturation, no animations beyond the most essential transitions. The previous brief said this; it's still true.
- **Spare.** No paragraphs of explanation in-UI. If something needs explaining, it shouldn't be there.
- **Storyteller-flavored where it fits, but not forced.** Words like *scene, prop, move* in the appropriate places. Not *task, todo, productivity, goal, deadline, priority*.
- **One screen.** Not metaphorically — literally. Three sections stacked. The Sunday Reflection is a separate route. That's two views total.
- **No empty-state evangelism.** When there are no tasks captured: "Nothing on your mind right now. That's good." When there's no Sunday Reflection yet: "First Sunday after install. We'll start next week."
- **Honor the body. The app is not the play.** When the user confirms an action that should lead to off-screen activity — tapping ✓ on Today's Scene, picking a reframe mode, completing a task — the app shows a brief 2-second auto-dismissing message reminding them to get off the phone:
  - After ✓ on Today's Scene: ***"Phone down. Go."***
  - After picking a reframe mode: ***"Now close this and go."***
  - After tapping Done on a task: ***"Done. Close the app."***

  These messages auto-dismiss. No buttons, no haptics, no celebration. They cost nothing and they honor the central premise: the app is a small piece of scaffolding; the play happens off-screen.

---

## 11. Anti-patterns — do NOT build these

The previous brief's anti-pattern list, repeated and extended:

- **No streaks. Ever.** Even subtle ones.
- **No notifications by default.** One optional Sunday reflection nudge is the entire notification surface.
- **No "you completed 5 tasks today" summaries.** Throughput tracking is anti-play.
- **No social features.**
- **No AI suggestions** in v1. Reframe templates are static lookup tables, not LLM calls.
- **No analytics dashboards.**
- **No customization that the user has to learn.** The seed pools are editable but pre-populated. Everything else is fixed.
- **No empty-state evangelism.**
- **No "this task is overdue" red badges.** Tasks have `createdAt`, that's all. Surfacing rules are based on age, not deadlines.
- **No account, no login, no cloud, no sync.** Single device, single user.
- **No "are you sure you want to drop this task?" confirmation dialogs.** Trust the user.
- **No re-prompting of the play personality assessment in v1.** It's frozen.

---

## 12. Test scenarios

Before declaring v1 done, the user should be able to complete each in under 60 seconds:

1. **Open the app, see today's scene, do it later, come back and ✓ it.** The "Phone down. Go." prompt appears for 2 seconds and auto-dismisses.
2. **Capture a thought ("respond to Grassmann about endpoint") in one line, hit enter, app clears.**
3. **Three days pass. The task surfaces in "What's been sitting." Reframe it via Kinesthete mode. New title appears. The "Now close this and go." prompt shows briefly.**
4. **A different task surfaces. Tap "Drop it." Task is abandoned immediately, no confirmation dialog.**
5. **Open the reframed task again the next day. ✓ Done. It disappears with the "Done. Close the app." prompt.**
6. **Sunday evening: dialog appears with the two open-ended questions. Answer both. See entry stored in Past Reflections.**
7. **Skip the Sunday Reflection three weeks running. The one-liner observation appears at the top of the Today screen, no judgment.**

If all seven work, the app is done for v1. **The success criterion is not task throughput. It's: is Deepak noticing more playful moments in his weeks than he was before the app existed?** The app cannot directly measure that. The Sunday Reflection is the proxy — eight weeks of question-1 answers, read as a body of evidence, are the measure. If they show richer noticing over time, the app is succeeding.

---

## 13. The honest section

A few things you, Claude Code, should know explicitly:

- **The user has a strong likelihood of abandoning this app after 1–4 weeks.** This is the modal outcome for ADHD productivity tools, the user knows this, and the brief is designed to lower the abandonment risk by being radically minimal — but it's still likely. Don't gold-plate v1. The app should work end-to-end and be useful on day one.

- **The user has explicit safety preferences in his Claude environment** about feature branches, plain-English explanations, change classification, rollback instructions. Honor those. They apply here.

- **He architects logic well, isn't fluent in syntax.** Write readable code. Comment the *why* of unusual choices, not the *what*.

- **He uses voice dictation extensively.** Test text inputs against dictated patterns: extra spaces, occasional homophone errors, sentence-end punctuation drift, German/English code-switching.

- **The reframe templates in §7.3 are seed examples only.** Improve them as you encounter real task titles during testing. They should feel personal, not generic.

- **If you find yourself wanting to add a feature "while you're at it," don't.** Note it in a TODO file at the project root. v1 ships when §9 step 10 is done.

- **The thing this app is competing with is not other productivity apps. It's the southwest balcony with the door open.** The app loses every time the user picks the balcony. That's a win.

On your mark, get set… build.
