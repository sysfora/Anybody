/**
 * A tiny synthesized "generation complete" chime built with the Web Audio
 * API — no binary audio asset to ship or maintain. A soft ascending
 * major-triad arpeggio (with a light octave "sparkle" on top) gives it a
 * pleasant, bell-like feel rather than a harsh notification beep.
 */

let audioCtx: AudioContext | null = null;

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

function getAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/**
 * Creates/resumes the shared AudioContext. Call this synchronously from
 * inside a real user gesture (click/keypress handler) well *before* the
 * chime needs to play — browsers only allow audio to start from a gesture,
 * but once the context is running it stays running for later, ungestured
 * calls like a `playGenerationCompleteSound()` fired from a socket event.
 */
export function unlockAudio(): void {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  } catch {
    // Best-effort only — never let this block the caller.
  }
}

function playNote(
  ctx: AudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  peakGain: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  // A quiet partial at 3x the fundamental gives the note a little bell-like
  // shimmer instead of sounding like a flat synthetic sine beep.
  const partial = ctx.createOscillator();
  const partialGain = ctx.createGain();
  partial.type = 'sine';
  partial.frequency.value = frequency * 3;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  partialGain.gain.setValueAtTime(0, startTime);
  partialGain.gain.linearRampToValueAtTime(peakGain * 0.18, startTime + 0.015);
  partialGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.6);

  osc.connect(gain).connect(ctx.destination);
  partial.connect(partialGain).connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
  partial.start(startTime);
  partial.stop(startTime + duration + 0.05);
}

/** Plays a short, pleasant chime — call once each time a generation completes. */
export function playGenerationCompleteSound(volume = 0.22): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // Ascending major triad + a light octave sparkle on top: C6 - E6 - G6 - C7.
    const notes: Array<{ freq: number; delay: number; duration: number; gain: number }> = [
      { freq: 1046.5, delay: 0, duration: 0.55, gain: volume },
      { freq: 1318.5, delay: 0.09, duration: 0.5, gain: volume * 0.9 },
      { freq: 1568.0, delay: 0.18, duration: 0.55, gain: volume * 0.85 },
      { freq: 2093.0, delay: 0.28, duration: 0.7, gain: volume * 0.5 },
    ];
    notes.forEach(({ freq, delay, duration, gain }) => {
      playNote(ctx, freq, now + delay, duration, gain);
    });
  } catch {
    // Sound is a nice-to-have — never let a playback error affect the app.
  }
}
