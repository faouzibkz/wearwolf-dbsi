/**
 * Personal, per-player game notes (Feature 7) — a private scratchpad each
 * player can jot down during discussions, server-synced so it survives a
 * disconnect/reconnect or a brand new device, not just tucked away in this
 * one browser's localStorage. Kept entirely in memory here, deliberately
 * NOT part of GameEngine's own persisted/serializable state: notes are a
 * player convenience, not game logic, and have no business surviving a
 * snapshot/undo, being visible to the admin, or ever being read by anyone
 * but the player who wrote them.
 *
 * Purged ONLY at GAME_ENDED (see handlers.ts's sync()) — explicitly not on
 * disconnect, not on an idle-cleanup sweep, not on any other event. They
 * persist through every round of the whole game, then reset to empty once
 * it's over.
 */
const notesByGame = new Map<string, Map<string, string>>(); // code -> playerId -> text

/** Generous but bounded — a defensive cap against an abusive client parking an enormous payload in memory, not a realistic limit for actual notes. */
const MAX_NOTE_LENGTH = 5000;

export function getNote(code: string, playerId: string): string {
  return notesByGame.get(code.toUpperCase())?.get(playerId) ?? "";
}

export function saveNote(code: string, playerId: string, text: string): void {
  const key = code.toUpperCase();
  let entries = notesByGame.get(key);
  if (!entries) {
    entries = new Map();
    notesByGame.set(key, entries);
  }
  entries.set(playerId, (text ?? "").slice(0, MAX_NOTE_LENGTH));
}

export function clearNotesForGame(code: string): void {
  notesByGame.delete(code.toUpperCase());
}
