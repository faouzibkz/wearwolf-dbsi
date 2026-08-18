import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * actionLog.ts reads ACTION_LOG_DIR from process.env at module-load time
 * (so the directory is computed once, not re-read on every call — see its
 * own doc comment), so each test gets an isolated temp directory via
 * vi.resetModules() + a fresh dynamic import, rather than sharing one
 * module instance across tests.
 */
describe("actionLog", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "actionlog-test-"));
    process.env.ACTION_LOG_DIR = dir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.ACTION_LOG_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  function readLines(now: Date): unknown[] {
    const day = now.toISOString().slice(0, 10);
    const path = join(dir, `actions-${day}.jsonl`);
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("writes one JSON line per call, with a timestamp and the given fields", async () => {
    const { logAction } = await import("./actionLog.js");
    const now = new Date("2026-08-18T12:00:00.000Z");
    logAction({ event: "NIGHT_ACTION_SUBMIT", gameCode: "ABCD", playerId: "p1" }, now);

    const lines = readLines(now);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "NIGHT_ACTION_SUBMIT",
      gameCode: "ABCD",
      playerId: "p1",
      ts: "2026-08-18T12:00:00.000Z",
    });
  });

  it("appends multiple entries to the same day's file in order", async () => {
    const { logAction } = await import("./actionLog.js");
    const now = new Date("2026-08-18T12:00:00.000Z");
    logAction({ event: "connect", socketId: "s1" }, now);
    logAction({ event: "NIGHT_ACTION_SUBMIT", socketId: "s1" }, now);
    logAction({ event: "disconnect", socketId: "s1", reason: "transport close" }, now);

    const lines = readLines(now) as { event: string }[];
    expect(lines.map((l) => l.event)).toEqual(["connect", "NIGHT_ACTION_SUBMIT", "disconnect"]);
  });

  it("writes to a different file for a different UTC day", async () => {
    const { logAction } = await import("./actionLog.js");
    const day1 = new Date("2026-08-18T23:59:00.000Z");
    const day2 = new Date("2026-08-19T00:01:00.000Z");
    logAction({ event: "connect" }, day1);
    logAction({ event: "connect" }, day2);

    expect(readLines(day1)).toHaveLength(1);
    expect(readLines(day2)).toHaveLength(1);
  });

  it("redacts hostToken/reconnectToken/password/token anywhere in the payload, at any nesting depth", async () => {
    const { logAction } = await import("./actionLog.js");
    const now = new Date("2026-08-18T12:00:00.000Z");
    logAction(
      {
        event: "PLAYER_RECONNECT",
        payload: {
          gameCode: "ABCD",
          reconnectToken: "super-secret",
          nested: { hostToken: "also-secret", password: "hunter2", token: "x", fine: "kept" },
        },
      },
      now,
    );

    const [entry] = readLines(now) as [{ payload: Record<string, unknown> }];
    expect(entry.payload.reconnectToken).toBe("[redacted]");
    expect(entry.payload.gameCode).toBe("ABCD");
    const nested = entry.payload.nested as Record<string, unknown>;
    expect(nested.hostToken).toBe("[redacted]");
    expect(nested.password).toBe("[redacted]");
    expect(nested.token).toBe("[redacted]");
    expect(nested.fine).toBe("kept");
  });

  it("drops non-serializable values (e.g. an ack callback) instead of throwing", async () => {
    const { logAction } = await import("./actionLog.js");
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(() =>
      logAction({ event: "NIGHT_ACTION_SUBMIT", payload: { targetId: "p2", ack: () => {} } }, now),
    ).not.toThrow();

    const [entry] = readLines(now) as [{ payload: Record<string, unknown> }];
    expect(entry.payload.targetId).toBe("p2");
    expect(entry.payload.ack).toBe("[fn]");
  });

  it("never throws even if the log directory can't be created", async () => {
    // Point at a path that can't possibly be created (a file, not a
    // directory, as the parent) to force mkdirSync to fail, and confirm
    // logAction swallows it rather than crashing the caller.
    const { writeFileSync } = await import("node:fs");
    const blockerFile = join(dir, "blocker");
    writeFileSync(blockerFile, "not a directory");
    process.env.ACTION_LOG_DIR = join(blockerFile, "logs");
    vi.resetModules();
    const { logAction } = await import("./actionLog.js");

    expect(() => logAction({ event: "connect" })).not.toThrow();
  });
});
