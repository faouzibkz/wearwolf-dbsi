import { describe, expect, it, vi } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { SOCKET_EVENTS, type NightStepStatePayload } from "@loupgarou/shared";

// broadcast.ts's OTHER export (broadcastGameState) calls persistGame, which
// pulls in Prisma (db/persistence.js -> db/prisma.ts) purely for its
// side-effecting DB write — completely irrelevant to pushNightStepState,
// the one function this file tests. Stubbed out so this test only needs a
// generated Prisma client in environments that actually run the real
// server (this sandbox has no network access to fetch Prisma's engine
// binaries, same class of constraint as "no Docker here" — see FEATURES.md
// §17's sandbox-constraints note).
vi.mock("../db/persistence.js", () => ({ persistGame: vi.fn() }));

import { pushNightStepState, broadcastGameState } from "./broadcast.js";
import { gameRegistry } from "../gameRegistry.js";

/**
 * Cahier de charge #2 §17.1d — server-side wiring for SEQUENTIAL night
 * mode. broadcastGameState/persistGame touch Prisma (see db/persistence.ts),
 * so this file deliberately only covers pushNightStepState, the one new
 * piece of socket/broadcast.ts logic with a real branch to get wrong (the
 * SIMULTANEOUS/non-NIGHT no-op guard) and a real payload shape to get
 * wrong (multi-role steps). Everything else added for this feature —
 * NightSequencer.ts, GameEngine's step methods — already has full coverage
 * in packages/game-engine/src/__tests__/sequentialNight.test.ts; this file
 * is purely the thin "does the right event reach the right room" layer on
 * top of that already-tested engine surface.
 */

// A minimal fake Socket.IO Server: just enough of `.to(room).emit(event, payload)`
// to observe what pushNightStepState actually sends, without spinning up a
// real socket.io instance or network.
function fakeIo() {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
  return { io: io as any, emitted };
}

function bootToSequentialNight1(roleCounts: Record<string, number>, names: string[]) {
  const engine = GameEngine.createGame({ roleCounts: roleCounts as any, nightMode: "SEQUENTIAL" });
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids[names[0]!]!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion(); // -> NIGHT 1 (SEQUENTIAL)
  return { engine, ids };
}

describe("pushNightStepState", () => {
  it("emits nothing at all in SIMULTANEOUS mode (the default)", () => {
    const names = ["Chef", "Salvateur", "Wolf", "V3"];
    const engine = GameEngine.createGame({ roleCounts: { SALVATEUR: 1, LOUP_GAROU: 1 } as any });
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids.Chef!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion(); // -> NIGHT 1, SIMULTANEOUS

    expect(engine.getPhase()).toBe("NIGHT");
    expect(engine.isSequentialNightMode()).toBe(false);

    const { io, emitted } = fakeIo();
    pushNightStepState(io, engine);
    expect(emitted).toHaveLength(0);
  });

  it("emits nothing outside NIGHT, even if nightMode is SEQUENTIAL", () => {
    const engine = GameEngine.createGame({ roleCounts: { VILLAGEOIS: 4 } as any, nightMode: "SEQUENTIAL" });
    for (const n of ["A", "B", "C", "D"]) engine.addPlayer(n);
    // Still LOBBY — never started.
    expect(engine.getPhase()).toBe("LOBBY");

    const { io, emitted } = fakeIo();
    pushNightStepState(io, engine);
    expect(emitted).toHaveLength(0);
  });

  it("broadcasts the current step, progress, and deadline to the whole game room", () => {
    const names = ["Chef", "Salvateur", "Wolf", "V3"];
    const { engine } = bootToSequentialNight1({ SALVATEUR: 1, LOUP_GAROU: 1 }, names);

    expect(engine.getCurrentNightStepRoleIds()).toEqual(["SALVATEUR"]);

    const { io, emitted } = fakeIo();
    pushNightStepState(io, engine);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.room).toBe(`game:${engine.getCode()}`);
    expect(emitted[0]!.event).toBe(SOCKET_EVENTS.NIGHT_STEP_STATE);

    const payload = emitted[0]!.payload as NightStepStatePayload;
    expect(payload.currentStepRoleIds).toEqual(["SALVATEUR"]);
    expect(payload.stepIndex).toBe(1);
    expect(payload.totalSteps).toBe(2); // SALVATEUR, then LOUP_GAROU
    expect(payload.stepDeadlineAt).not.toBeNull();
  });

  it("bundles multiple roles sharing one collective step into a single currentStepRoleIds array", () => {
    // LOUP_GAROU + LOUP_BLANC share the exact same nightPriority (30) and
    // therefore the exact same sequential step — see NightSequencer.ts.
    const names = ["Chef", "Wolf", "WhiteWolf", "V3", "V4", "V5"];
    const { engine } = bootToSequentialNight1({ LOUP_GAROU: 1, LOUP_BLANC: 1 }, names);

    expect(engine.getCurrentNightStepRoleIds()).toEqual(
      expect.arrayContaining(["LOUP_GAROU", "LOUP_BLANC"]),
    );

    const { io, emitted } = fakeIo();
    pushNightStepState(io, engine);

    const payload = emitted[0]!.payload as NightStepStatePayload;
    expect(payload.currentStepRoleIds).toHaveLength(2);
    expect(payload.currentStepRoleIds).toEqual(expect.arrayContaining(["LOUP_GAROU", "LOUP_BLANC"]));
    expect(payload.stepIndex).toBe(1);
    expect(payload.totalSteps).toBe(1); // the pack's shared vote is the only step tonight
  });

  it("reports currentStepRoleIds: null and stepDeadlineAt: null once every step is behind us", () => {
    const names = ["Chef", "Salvateur", "Wolf", "V3"];
    const { engine } = bootToSequentialNight1({ SALVATEUR: 1, LOUP_GAROU: 1 }, names);

    while (engine.getCurrentNightStepRoleIds() !== null) engine.forceAdvanceNightStep();
    // Night resolved -> back out of SEQUENTIAL-night mode (either MORNING or ENDED).
    expect(engine.isSequentialNightMode()).toBe(false);

    const { io, emitted } = fakeIo();
    pushNightStepState(io, engine);
    // isSequentialNightMode() is false once we've left NIGHT -> no broadcast at all,
    // exactly like the SIMULTANEOUS-mode case above (nothing left to report).
    expect(emitted).toHaveLength(0);
  });
});

/**
 * 19 août 2026 (FEATURES.md §28) — real live-game report: broadcasting the
 * TRUE isConnected/disconnectPausedPlayerId to the whole room let every
 * player watch whose name flickered "reconnecting", which — since that
 * only ever happens while it's specifically that player's turn — told the
 * whole table which role was currently acting. broadcastGameState must
 * send the room a version with that identity stripped, while still giving
 * the admin the real thing.
 */
describe("broadcastGameState: room broadcast never leaks WHICH player is disconnected", () => {
  function bootToDayVote(names: string[]) {
    const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } as any });
    const ids: Record<string, string> = {};
    for (const n of names) ids[n] = engine.addPlayer(n).id;
    engine.startGame();
    engine.volunteerForChef(ids[names[0]!]!);
    engine.forceStartChefDebate();
    engine.advanceChefSpeaker();
    for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids[names[0]!]!);
    engine.tallyChefVoteAndProceed();
    engine.proceedFromChefRevealToDiscussion();
    engine.endDay1Discussion();
    if (engine.getPhase() === "NIGHT") engine.resolveNightAndProceed();
    engine.proceedFromMorningToDay();
    engine.endDayDiscussion();
    return { engine, ids };
  }

  function findPayload(emitted: { room: string; event: string; payload: unknown }[], event: string) {
    return emitted.find((e) => e.event === event)?.payload as any;
  }

  it("masks a plain disconnected alive player's isConnected in the room broadcast, but not in ADMIN_STATE", () => {
    const { engine, ids } = bootToDayVote(["A", "B", "C", "D"]);
    engine.setConnected(ids.B!, false);

    gameRegistry.setAdminSocket(engine.getCode(), "admin-socket-1");
    const { io, emitted } = fakeIo();
    broadcastGameState(io, engine);

    const roomState = findPayload(emitted, SOCKET_EVENTS.GAME_STATE);
    const roomB = roomState.players.find((p: any) => p.id === ids.B);
    expect(roomB.isConnected).toBe(true); // masked, even though they're really disconnected

    const adminPayload = emitted.find((e) => e.room === "admin-socket-1");
    const adminB = (adminPayload!.payload as any).state.players.find((p: any) => p.id === ids.B);
    expect(adminB.isConnected).toBe(false); // admin sees the truth
  });

  it("does not mask a DEAD player's isConnected (no secrecy concern once they're out)", () => {
    const { engine, ids } = bootToDayVote(["A", "B", "C", "D"]);
    engine.adminKillPlayer(ids.B!);
    engine.setConnected(ids.B!, false);

    const { io, emitted } = fakeIo();
    broadcastGameState(io, engine);

    const roomState = findPayload(emitted, SOCKET_EVENTS.GAME_STATE);
    const roomB = roomState.players.find((p: any) => p.id === ids.B);
    expect(roomB.isConnected).toBe(false);
  });

  it("strips disconnectPausedPlayerId from the room broadcast but keeps isPausedForDisconnect true, while ADMIN_STATE keeps the real id", () => {
    const { engine, ids } = bootToDayVote(["A", "B", "C", "D"]);
    const currentVoter = engine.getCurrentDayVoterId()!;
    engine.pauseForDisconnect(currentVoter);
    expect(engine.getPublicState().paused).toBe(true);

    gameRegistry.setAdminSocket(engine.getCode(), "admin-socket-2");
    const { io, emitted } = fakeIo();
    broadcastGameState(io, engine);

    const roomState = findPayload(emitted, SOCKET_EVENTS.GAME_STATE);
    expect(roomState.disconnectPausedPlayerId).toBeNull();
    expect(roomState.isPausedForDisconnect).toBe(true);
    expect(Object.values(ids)).toContain(currentVoter); // sanity: a real player id exists to have been hidden

    const adminPayload = emitted.find((e) => e.room === "admin-socket-2");
    expect((adminPayload!.payload as any).state.disconnectPausedPlayerId).toBe(currentVoter);
  });
});
