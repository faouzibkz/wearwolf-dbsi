import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { SOCKET_EVENTS, type GameStatePublic } from "@loupgarou/shared";

// sync() pulls in Prisma through several paths (db/persistence.js's
// persistGame, rating/applyRating.js, progression/applyProgression.js all
// import ../db/prisma.js directly) — mocked at the source module instead of
// each individual consumer, for the same reason as broadcast.test.ts and
// afterlife.test.ts: no network access in this sandbox to fetch Prisma's
// engine binaries. None of these DB paths are actually exercised by the
// scenarios below (they only run once GAME_ENDED fires, which nothing here
// triggers) — this only needs to satisfy the module graph at import time.
vi.mock("../db/prisma.js", () => ({ prisma: { game: { upsert: vi.fn().mockResolvedValue({}) } } }));

import { sync } from "./handlers.js";

/**
 * Regression test for a real, previously-shipped bug: sync() used to call
 * pushAllPrompts (which broadcasts GAME_STATE.phaseEndsAt, and — during a
 * SEQUENTIAL night — NIGHT_PROMPT/NIGHT_STEP_STATE's deadlineAt too) BEFORE
 * schedulePhaseTimer, which is the ONLY thing that ever actually computes a
 * fresh phaseEndsAt (via GameEngine.setPhaseTimer — see timers.ts). That
 * meant every single phase/speaker/step transition briefly broadcast the
 * PREVIOUS phase's already-expired deadline, and the corrected one only
 * reached clients whenever some unrelated later action happened to trigger
 * another broadcast — the exact "timer sometimes shows 0:00" symptom
 * reported after the sequential-night feature shipped, but really an
 * old bug affecting every phase (day discussion, day vote, chef debate,
 * night actions), not something introduced by that feature.
 *
 * This test exercises the REAL exported sync() end-to-end (not a
 * reimplementation of its internals) with fake timers, so it fails loudly
 * if the two calls inside sync() (or inside timers.ts's own setTimeout
 * callbacks) are ever reordered again.
 */
function fakeIo() {
  const emittedByRoom: Record<string, unknown[]> = {};
  const io = {
    to(room: string) {
      return {
        emit(_event: string, payload: unknown) {
          (emittedByRoom[room] ??= []).push(payload);
        },
      };
    },
  };
  return { io: io as any, emittedByRoom };
}

function latestGameState(emittedByRoom: Record<string, unknown[]>, code: string): GameStatePublic {
  const room = `game:${code.toUpperCase()}`;
  const list = emittedByRoom[room] as GameStatePublic[];
  return list[list.length - 1]!;
}

describe("sync() timer ordering (schedule THEN broadcast, never the reverse)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a CHEF_DEBATE speaker change broadcasts the NEW speaker's fresh deadline, not the previous speaker's", () => {
    const engine = GameEngine.createGame({ roleCounts: { VILLAGEOIS: 4 } as any });
    const ids: string[] = [];
    for (const n of ["A", "B", "C", "D"]) ids.push(engine.addPlayer(n).id);
    engine.startGame();
    engine.volunteerForChef(ids[0]!);
    engine.volunteerForChef(ids[1]!);
    engine.forceStartChefDebate();
    expect(engine.getPhase()).toBe("CHEF_DEBATE");

    const { io, emittedByRoom } = fakeIo();
    sync(io, engine); // simulates the broadcast right after forceStartChefDebate's own handler

    const firstBroadcast = latestGameState(emittedByRoom, engine.getCode());
    const firstDeadline = firstBroadcast.phaseEndsAt;
    expect(firstDeadline).not.toBeNull();
    // The seeded deadline must be a FRESH one anchored to "now" (the fake
    // system time above), not null/stale — i.e. schedulePhaseTimer already
    // ran before this first broadcast.
    expect(firstDeadline!).toBeGreaterThan(Date.now());

    // 7 seconds pass, then the debate moves to the next speaker — a
    // genuine transition (new currentSpeakerId), which MUST reset the
    // deadline to a fresh full duration for the new speaker.
    vi.setSystemTime(new Date(Date.now() + 7000));
    engine.advanceChefSpeaker();
    sync(io, engine);

    const secondBroadcast = latestGameState(emittedByRoom, engine.getCode());
    const secondDeadline = secondBroadcast.phaseEndsAt;
    expect(secondDeadline).not.toBeNull();

    // The bug: if pushAllPrompts ran before schedulePhaseTimer, this
    // broadcast would still carry `firstDeadline` (now only ~ (duration -
    // 7000)ms away, or already in the past for a short-enough debate
    // duration) instead of a deadline freshly anchored to the CURRENT
    // (post-advance) "now". Asserting it's strictly later than the first
    // deadline is only possible if it was recomputed from the new "now",
    // 7 seconds after the first one was set.
    expect(secondDeadline!).toBeGreaterThan(firstDeadline!);
    expect(secondDeadline!).toBeGreaterThan(Date.now());
  });

  it("a DAY_VOTE turn change broadcasts a fresh per-voter deadline immediately, not the previous voter's", () => {
    // Includes a lone wolf, kept alive throughout, purely so the game
    // doesn't instantly declare a "no wolves" VILLAGE victory the moment
    // night resolves (VictoryConditions.villageEliminatesAllWolves) —
    // same reasoning documented throughout sequentialNight.test.ts.
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } as any });
    const ids: string[] = [];
    for (const n of ["A", "B", "C", "D", "E"]) ids.push(engine.addPlayer(n).id);
    engine.startGame();
    engine.volunteerForChef(ids[0]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const id of ids.slice(1)) engine.castChefVote(id, ids[0]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();
    // Force through night 1 straight to DAY_VOTE — nobody submits a night
    // action, so nobody dies and MORNING follows normally.
    engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    expect(engine.getPhase()).toBe("DAY_VOTE");

    const { io, emittedByRoom } = fakeIo();
    sync(io, engine);
    const firstDeadline = latestGameState(emittedByRoom, engine.getCode()).phaseEndsAt;
    expect(firstDeadline).not.toBeNull();

    vi.setSystemTime(new Date(Date.now() + 4000));
    const firstVoterId = engine.getCurrentDayVoterId()!;
    engine.castDayVote(firstVoterId, ids.find((id) => id !== firstVoterId)!);
    sync(io, engine);

    const secondDeadline = latestGameState(emittedByRoom, engine.getCode()).phaseEndsAt;
    expect(secondDeadline).not.toBeNull();
    expect(secondDeadline!).toBeGreaterThan(firstDeadline!);
    expect(secondDeadline!).toBeGreaterThan(Date.now());
  });

  it("a SEQUENTIAL night step advance broadcasts a fresh NIGHT_STEP_STATE deadline, not the previous step's", () => {
    const engine = GameEngine.createGame({
      roleCounts: { SALVATEUR: 1, LOUP_GAROU: 1 } as any,
      nightMode: "SEQUENTIAL",
    });
    const ids: string[] = [];
    for (const n of ["A", "B", "C", "D"]) ids.push(engine.addPlayer(n).id);
    engine.startGame();
    engine.volunteerForChef(ids[0]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const id of ids.slice(1)) engine.castChefVote(id, ids[0]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();
    expect(engine.getPhase()).toBe("NIGHT");
    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SALVATEUR"]);

    function latestNightStepState(emittedByRoom: Record<string, unknown[]>, code: string) {
      const room = `game:${code.toUpperCase()}`;
      const list = emittedByRoom[room] as { currentStepRoleIds?: unknown }[];
      const stepStates = list.filter((p) => "currentStepRoleIds" in p);
      return stepStates[stepStates.length - 1] as
        | { currentStepRoleIds: string[] | null; stepDeadlineAt: number | null }
        | undefined;
    }

    const { io, emittedByRoom } = fakeIo();
    sync(io, engine);
    const firstStepState = latestNightStepState(emittedByRoom, engine.getCode())!;
    expect(firstStepState.currentStepRoleIds).toEqual(["SALVATEUR"]);
    expect(firstStepState.stepDeadlineAt).not.toBeNull();

    // 6 seconds pass, then the Salvateur's step completes and the sequence
    // advances to the wolves' step — a genuine step transition, which MUST
    // reset the deadline to a fresh full duration for the new step.
    vi.setSystemTime(new Date(Date.now() + 6000));
    const salvateurId = ids.find((id) => engine.getAdminRoles().find((r) => r.playerId === id)?.roleId === "SALVATEUR")!;
    engine.submitNightAction(salvateurId, "PROTECT", ids.find((id) => id !== salvateurId)!);
    sync(io, engine);

    const secondStepState = latestNightStepState(emittedByRoom, engine.getCode())!;
    expect(secondStepState.currentStepRoleIds).toEqual(["LOUP_GAROU"]);
    expect(secondStepState.stepDeadlineAt).not.toBeNull();
    // The bug: if pushAllPrompts ran before schedulePhaseTimer, this would
    // still carry the Salvateur step's now-6-seconds-more-expired deadline
    // instead of a fresh one anchored to the current "now" for the wolves.
    expect(secondStepState.stepDeadlineAt!).toBeGreaterThan(firstStepState.stepDeadlineAt!);
    expect(secondStepState.stepDeadlineAt!).toBeGreaterThan(Date.now());
  });
});
