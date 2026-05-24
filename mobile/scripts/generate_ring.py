#!/usr/bin/env python3
"""Generate assets/ring.wav matching the desktop playCallRing() rock-guitar riff.

Mirrors the Web Audio chain in client/src/renderer/services/sounds.ts:
  - 9 sawtooth oscillators (E3/B3/E4, G3/D4/G4, A3/E4/A4 power chords)
  - exponential decay envelope per note
  - soft-clipping waveshaper distortion
  - master gain 0.25
Output: 16-bit PCM mono 44.1 kHz WAV, ~0.85 s.

Run once when the riff changes — output is committed to assets/ring.wav.
"""
import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 44100
DURATION_S = 0.85  # length of the riff (last note starts at 0.4 + 0.3 = 0.7, plus tail)
NUM_SAMPLES = int(SAMPLE_RATE * DURATION_S)

# Same notes/timing as the desktop riff
RIFF = [
    # (freq_hz, start_s, dur_s)
    (164.81, 0.00, 0.15),  # E3
    (246.94, 0.00, 0.15),  # B3
    (329.63, 0.00, 0.15),  # E4
    (196.00, 0.20, 0.15),  # G3
    (293.66, 0.20, 0.15),  # D4
    (392.00, 0.20, 0.15),  # G4
    (220.00, 0.40, 0.30),  # A3
    (329.63, 0.40, 0.30),  # E4
    (440.00, 0.40, 0.30),  # A4
]

NOTE_GAIN = 0.4
MASTER_GAIN = 0.25


def waveshaper(x: float) -> float:
    """Soft clipper, same curve as the desktop WaveShaperNode."""
    return ((math.pi + 50.0) * x) / (math.pi + 50.0 * abs(x) + 1e-9)


def synth_note(samples: list[float], freq: float, start_s: float, dur_s: float) -> None:
    """Mix one sawtooth note with exponential decay into the buffer."""
    start_idx = int(start_s * SAMPLE_RATE)
    end_idx = min(int((start_s + dur_s) * SAMPLE_RATE), len(samples))
    decay_ratio = 0.001 / NOTE_GAIN
    for i in range(start_idx, end_idx):
        t_in_note = (i - start_idx) / SAMPLE_RATE
        envelope = NOTE_GAIN * (decay_ratio ** (t_in_note / dur_s))
        phase = (i / SAMPLE_RATE) * freq
        # Sawtooth in [-1, 1]
        sawtooth = 2.0 * (phase - math.floor(phase + 0.5))
        samples[i] += sawtooth * envelope


def render() -> bytes:
    samples = [0.0] * NUM_SAMPLES
    for freq, start_s, dur_s in RIFF:
        synth_note(samples, freq, start_s, dur_s)
    out = bytearray()
    for s in samples:
        v = waveshaper(s) * MASTER_GAIN
        if v > 1.0:
            v = 1.0
        elif v < -1.0:
            v = -1.0
        out.extend(struct.pack("<h", int(v * 32767)))
    return bytes(out)


def main() -> None:
    pcm = render()
    out_path = Path(__file__).resolve().parent.parent / "assets" / "ring.wav"
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    print(f"Wrote {out_path}: {len(pcm)} bytes ({DURATION_S:.2f}s @ {SAMPLE_RATE} Hz mono 16-bit)")


if __name__ == "__main__":
    main()
