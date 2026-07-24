"use client";

/**
 * Ambient sound cues, synthesized on the fly with the Web Audio API — no
 * external audio files to host or license. Every cue checks the caller's
 * `enabled` flag (which should always be `state.soundEffectsEnabled`, the
 * server-authoritative global switch the admin controls) so a single
 * toggle mutes every player at once.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  type: OscillatorType = "sine",
  peakGain = 0.15,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/** Night falls: a low, slow rising-then-falling tone evoking a distant howl. */
export function playNightHowl(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.linearRampToValueAtTime(420, now + 0.6);
  osc.frequency.linearRampToValueAtTime(150, now + 1.6);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.14, now + 0.15);
  gain.gain.linearRampToValueAtTime(0.09, now + 1.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 2);
}

/** Morning: a bright, quick ascending triad evoking a rooster crow. */
export function playMorningRooster(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  [660, 880, 990].forEach((freq, i) => tone(ctx, freq, now + i * 0.12, 0.22, "square", 0.1));
}

/** Someone died: a low, resonant bell toll. */
export function playDeathBell(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  tone(ctx, 220, now, 1.4, "sine", 0.18);
  tone(ctx, 440, now, 1.0, "sine", 0.07);
}

/** Game over: a short arpeggio, brighter for the village, darker for the wolves. */
export function playVictoryFanfare(enabled: boolean, winner: "VILLAGE" | "LOUPS"): void {
  if (!enabled) return;
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = winner === "VILLAGE" ? [523, 659, 784, 1046] : [220, 246, 196, 174];
  notes.forEach((freq, i) => tone(ctx, freq, now + i * 0.16, 0.35, "triangle", 0.16));
}
