import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Persistent, structured, append-only log of every socket event this server
 * sees — connects, disconnects (with their reason), and every game action —
 * one compact JSON object per line (JSONL), one file per calendar day.
 *
 * Deliberately NOT just console.log: stdout only survives as long as the
 * Docker CONTAINER does — `docker compose down`, a rebuild, or a host reboot
 * all wipe it, which made a real "what actually happened during that game"
 * postmortem impossible (see FEATURES.md §23's investigation, which had to
 * infer connection drops indirectly from nginx's access log instead of
 * seeing them directly). This writes to a file under LOG_DIR instead —
 * bind-mounted as a volume in docker-compose.yml — so it survives restarts
 * and rebuilds, and `docker compose exec server` (or looking at the mounted
 * host folder directly) can read it after the fact.
 *
 * Deliberately dependency-free (no winston/pino): `appendFileSync` is
 * synchronous and more than fast enough for the modest event volume of a
 * ~10-player party game, and a single small file with zero new dependencies
 * avoids repeating the "can't reliably npm install in some environments"
 * pain already documented in ARCHITECTURE.md §9 — nothing here needs to be
 * more sophisticated than "append a line to a file."
 */

const LOG_DIR = process.env.ACTION_LOG_DIR ?? join(process.cwd(), "logs");

let dirEnsured = false;
function ensureDir(): void {
  if (dirEnsured) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Best-effort — logAction's own try/catch handles a write failure
    // either way (e.g. a read-only filesystem in some deployment).
  }
  dirEnsured = true;
}

/** One file per UTC calendar day — "actions-2026-08-18.jsonl" — so a long-running server doesn't accumulate one unbounded file, and a specific game night is easy to find by date. */
function currentLogPath(now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return join(LOG_DIR, `actions-${day}.jsonl`);
}

/** Field names that must never be written verbatim — session/auth secrets, not game data. */
const REDACTED_KEYS = new Set(["hostToken", "reconnectToken", "password", "token"]);

/** Shallow-redacts known-sensitive fields and drops non-serializable values (ack callbacks) before logging — this is a diagnostic trail for game actions, not a place to persist secrets. */
function redact(value: unknown): unknown {
  if (typeof value === "function") return "[fn]";
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export interface ActionLogEntry {
  event: string;
  gameCode?: string;
  playerId?: string;
  isAdmin?: boolean;
  socketId?: string;
  ok?: boolean;
  error?: string;
  tookMs?: number;
  payload?: unknown;
  reason?: string;
}

/**
 * Best-effort, never throws — a logging problem must never break the actual
 * game action it's observing. On failure, falls back to a single
 * console.error (still visible via `docker compose logs server` even though
 * the structured/persistent log itself is unavailable) rather than crashing
 * or silently losing the write with zero trace at all.
 */
export function logAction(entry: ActionLogEntry, now: Date = new Date()): void {
  try {
    ensureDir();
    const line = JSON.stringify({ ts: now.toISOString(), ...entry, payload: redact(entry.payload) });
    appendFileSync(currentLogPath(now), line + "\n");
  } catch (err) {
    console.error("[action-log] failed to write", err);
  }
}
