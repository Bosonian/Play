#!/usr/bin/env python3
"""Generates the two Android notification-channel chimes for Runway
(landscape focus + audio cues increment).

stdlib-only (`wave` + `math`) - no numpy/pydub/etc dependency, so this runs
anywhere Python 3 does, with no `pip install` step. Re-run this script any
time the tones need to change; it always overwrites the two output files in
place.

Output: 44.1 kHz mono 16-bit PCM WAV, written directly to
android/app/src/main/res/raw/ - Android raw resource names must be
lowercase + underscores only, no dots (the resource id is derived from the
filename with its extension stripped), which is why these are
runway_staged.wav / runway_leave.wav rather than runway-staged.wav.

  - runway_staged.wav: a gentle two-tone rise (660 Hz -> 880 Hz), for the
    three lower-urgency "getting ready" alarm stages (start / wrap up /
    leave in 5) - see src/native/notifications.ts's STAGED_CHANNEL_ID.
  - runway_leave.wav: a firmer three-note rising chime (660 -> 880 ->
    1100 Hz), for the high-importance "leave now" stage and the sprint/
    exam-timer end alarms - see LEAVE_CHANNEL_ID in the same file. Louder
    (-6 dBFS vs. -12 dBFS peak) and busier (three notes, not two) so it's
    audibly distinct from the staged chime even heard from another room,
    which is the whole point of this increment: right now both channels
    share Android's default notification sound, so a "start getting
    ready" nudge and a "leave now" alert are indistinguishable by ear.
"""

import math
import os
import wave

SAMPLE_RATE = 44_100
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2  # 16-bit
FADE_MS = 15

RAW_DIR = os.path.join(
    os.path.dirname(__file__), "..", "android", "app", "src", "main", "res", "raw"
)


def db_to_amplitude(db: float) -> float:
    """Converts a dBFS peak target into a linear amplitude fraction of full
    scale (1.0 = 0 dBFS = the loudest a 16-bit sample can go without
    clipping)."""
    return 10 ** (db / 20)


def tone(freq_hz: float, duration_ms: int, peak_amplitude: float) -> list[float]:
    """One sine tone, in [-1, 1] float samples, with a linear fade-in/out
    (FADE_MS each end) so the tone starts and stops without an audible
    click - a sine that just switches on/off at full amplitude has a
    discontinuous jump at both edges, which the ear hears as a "tick" or
    "pop" layered on top of the tone itself."""
    n_samples = int(SAMPLE_RATE * duration_ms / 1000)
    fade_samples = int(SAMPLE_RATE * FADE_MS / 1000)
    samples = []
    for i in range(n_samples):
        angle = 2 * math.pi * freq_hz * (i / SAMPLE_RATE)
        value = math.sin(angle) * peak_amplitude
        if i < fade_samples:
            value *= i / fade_samples
        elif i >= n_samples - fade_samples:
            value *= (n_samples - i) / fade_samples
        samples.append(value)
    return samples


def silence(duration_ms: int) -> list[float]:
    return [0.0] * int(SAMPLE_RATE * duration_ms / 1000)


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "wb") as f:
        f.setnchannels(CHANNELS)
        f.setsampwidth(SAMPLE_WIDTH_BYTES)
        f.setframerate(SAMPLE_RATE)
        max_int = 2 ** (8 * SAMPLE_WIDTH_BYTES - 1) - 1  # 32767 for 16-bit
        frames = bytearray()
        for value in samples:
            clamped = max(-1.0, min(1.0, value))
            frames += int(clamped * max_int).to_bytes(2, byteorder="little", signed=True)
        f.writeframes(bytes(frames))


def build_staged() -> list[float]:
    """Gentle two-tone: 660 Hz for 150 ms, straight into 880 Hz for 250 ms,
    -12 dBFS peak - a soft "heads up" for the three lower-urgency stages."""
    amp = db_to_amplitude(-12)
    return tone(660, 150, amp) + tone(880, 250, amp)


def build_leave() -> list[float]:
    """Firmer three-note rise: 660 / 880 / 1100 Hz, 150 ms each with a short
    20 ms gap between notes, -6 dBFS peak - louder and busier than the
    staged chime on purpose (see module docstring)."""
    amp = db_to_amplitude(-6)
    gap = silence(20)
    return (
        tone(660, 150, amp)
        + gap
        + tone(880, 150, amp)
        + gap
        + tone(1100, 150, amp)
    )


def main() -> None:
    os.makedirs(RAW_DIR, exist_ok=True)
    write_wav(os.path.join(RAW_DIR, "runway_staged.wav"), build_staged())
    write_wav(os.path.join(RAW_DIR, "runway_leave.wav"), build_leave())
    print(f"Wrote runway_staged.wav and runway_leave.wav to {os.path.abspath(RAW_DIR)}")


if __name__ == "__main__":
    main()
