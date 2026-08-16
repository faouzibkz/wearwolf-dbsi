/**
 * Ephemeral, in-memory store for the LIVE "who's currently considering
 * whom" preview during the wolves' KILL_VOTE night prompt (Feature 6) —
 * deliberately NOT part of GameEngine's own persisted state (see
 * WolfTargetPreviewPayload's doc comment in packages/shared/src/events.ts):
 * it's a pure UI courtesy, not game logic, and has no business surviving a
 * server restart, an admin's "Annuler", or a serialized snapshot.
 *
 * Keyed by game code, then by voterId -> targetId. A voter's entry is
 * removed the moment they clear their local selection (targetId: null) or
 * their vote actually gets confirmed (see handlers.ts's NIGHT_ACTION_SUBMIT,
 * which clears it right before re-syncing).
 */
const previewsByGame = new Map<string, Map<string, string>>();
/** Last night number we served for each game — lets getWolfTargetPreviews auto-wipe stale previews once a NEW night starts, with no extra call site needed anywhere else. */
const lastNightNumberByGame = new Map<string, number>();

export function setWolfTargetPreview(code: string, voterId: string, targetId: string | null): void {
  const key = code.toUpperCase();
  let entries = previewsByGame.get(key);
  if (!entries) {
    entries = new Map();
    previewsByGame.set(key, entries);
  }
  if (targetId) entries.set(voterId, targetId);
  else entries.delete(voterId);
}

export function clearWolfTargetPreviewForVoter(code: string, voterId: string): void {
  previewsByGame.get(code.toUpperCase())?.delete(voterId);
}

/**
 * The game's current preview map — but first wipes it out entirely if
 * `nightNumber` has moved on since the last call. A preview from last
 * night has no business bleeding into the first render of a brand new
 * one; nightNumber (GameEngine's own monotonic "which night is this"
 * counter) is a simple, always-available signature for detecting that
 * without any other module needing to remember to call a "night started"
 * hook.
 */
export function getWolfTargetPreviews(code: string, nightNumber: number): Record<string, string> {
  const key = code.toUpperCase();
  // Only wipe when we've previously seen a DIFFERENT night number for this
  // code — a never-before-seen code (no entry at all yet) is not a
  // rollover, just a first call, and must not nuke whatever was already
  // just set for it earlier in the same night.
  if (lastNightNumberByGame.has(key) && lastNightNumberByGame.get(key) !== nightNumber) {
    previewsByGame.delete(key);
  }
  lastNightNumberByGame.set(key, nightNumber);
  return Object.fromEntries(previewsByGame.get(key) ?? []);
}
