# Reactive tapping feedback — 0.16.2

A recorded in-target pointer-down gets the same brief colour feedback whether or
not it alternates correctly. Only the touched target changes; no next-target cue,
geometry changes or success/error colour coding is introduced. Outside, late and
multiple-pointer-interrupted touches get no feedback. Acquisition records timing
before starting feedback and never waits for a haptic response.

Android uses a light native View haptic request. It respects system touch-feedback
settings and needs no new permission. Unsupported platforms still show colour
feedback. Haptic failure does not change counts, technical quality or saving.
Feedback timers/requests are cleared or rejected on completion, hand change,
interruption and unmount; stale haptic work is dropped rather than queued.

This is measurement protocol v4, with feature schema v2 unchanged. Historical v3
fixed-target tests had no explicit feedback. New records include feedback version
and configuration; haptic metadata means requested/system-controlled, never a
claim that a physical vibration was delivered. Do not silently pool acquisition
conditions for research analysis.

The Android approach follows the official View haptic API documentation:
https://developer.android.com/develop/ui/views/haptics/haptic-feedback

Device acceptance: complete both hands with touch vibration enabled and disabled,
try fast repeated/alternating taps, outside taps, two fingers, background and test
completion. Verify immediate modest colour acknowledgement, comfortable ticks
when enabled, no delayed ticks afterward and unchanged recorded tap counts. Unit
and build checks cannot establish physical vibration strength on the user's phone.
