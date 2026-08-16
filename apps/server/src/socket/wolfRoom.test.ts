import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { SOCKET_EVENTS, type WolfRoomStatePayload } from "@loupgarou/shared";

// wolfRoom.ts -> broadcast.ts -> db/persistence.ts -> Prisma, unavailable in
// this sandbox (see broadcast.test.ts's own note). Same fix: stub it out.
vi.mock("../db/persistence.js", () => ({ persistGame: vi.fn() }));

import { pushWolfRoomState } from "./wolfRoom.js";
import {
  clearWolfTargetPreviewForVoter,
  getWolfTargetPreviews,
  setWolfTargetPreview,
} from "./wolfTargetPreview.js";

/** Same minimal fake Socket.IO Server as broadcast.test.ts's fakeIo(). */
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

function bootToNight1TwoWolves() {
  const names = ["Chef", "WolfA", "WolfB", "Villager"];
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 2 } as any });
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  engine.volunteerForChef(ids.Chef!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion(); // -> NIGHT 1
  expect(engine.getPhase()).toBe("NIGHT");

  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  const wolves = names.filter((n) => roles.get(ids[n]!) === "LOUP_GAROU");
  return { engine, ids, wolves };
}

describe("wolfTargetPreview registry", () => {
  const usedCodes: string[] = [];
  afterEach(() => {
    // Nothing to explicitly tear down (module-level Maps keyed by game
    // code) beyond using a fresh code per test, which the boot helper
    // already guarantees via GameEngine's own random code generation.
    usedCodes.splice(0);
  });

  it("returns empty for a game with no previews yet", () => {
    expect(getWolfTargetPreviews("NEWCODE1", 1)).toEqual({});
  });

  it("records and returns a voter's preview", () => {
    setWolfTargetPreview("CODE2", "wolf-a", "victim-1");
    expect(getWolfTargetPreviews("CODE2", 1)).toEqual({ "wolf-a": "victim-1" });
  });

  it("clears a voter's preview when targetId is null", () => {
    setWolfTargetPreview("CODE3", "wolf-a", "victim-1");
    setWolfTargetPreview("CODE3", "wolf-a", null);
    expect(getWolfTargetPreviews("CODE3", 1)).toEqual({});
  });

  it("clearWolfTargetPreviewForVoter removes just that voter's entry", () => {
    setWolfTargetPreview("CODE4", "wolf-a", "victim-1");
    setWolfTargetPreview("CODE4", "wolf-b", "victim-2");
    clearWolfTargetPreviewForVoter("CODE4", "wolf-a");
    expect(getWolfTargetPreviews("CODE4", 1)).toEqual({ "wolf-b": "victim-2" });
  });

  it("auto-wipes stale previews once the night number moves on", () => {
    setWolfTargetPreview("CODE5", "wolf-a", "victim-1");
    expect(getWolfTargetPreviews("CODE5", 1)).toEqual({ "wolf-a": "victim-1" });
    // Night 2 starts — a leftover night-1 preview must not leak into it.
    expect(getWolfTargetPreviews("CODE5", 2)).toEqual({});
    // And it stays cleared for subsequent calls at the same night number.
    expect(getWolfTargetPreviews("CODE5", 2)).toEqual({});
  });

  it("is keyed case-insensitively by code, matching gameRegistry's own convention", () => {
    setWolfTargetPreview("code6", "wolf-a", "victim-1");
    expect(getWolfTargetPreviews("CODE6", 1)).toEqual({ "wolf-a": "victim-1" });
  });
});

describe("pushWolfRoomState — currentVotes + previewVotes (Feature 6)", () => {
  it("sends both confirmed and preview votes to every wolf room member", () => {
    const { engine, ids, wolves } = bootToNight1TwoWolves();
    const wolfAId = ids[wolves[0]!]!;
    const wolfBId = ids[wolves[1]!]!;
    const villagerId = ids.Villager!;

    // WolfA is only PREVIEWING the villager (hasn't confirmed).
    setWolfTargetPreview(engine.getCode(), wolfAId, villagerId);
    // WolfB has CONFIRMED a kill vote for the villager.
    engine.submitNightAction(wolfBId, "KILL_VOTE", villagerId);
    // A real NIGHT_ACTION_SUBMIT handler would also clear WolfB's own
    // preview entry at this point (see handlers.ts) — simulate that here
    // since we're calling the engine directly, bypassing the handler.
    clearWolfTargetPreviewForVoter(engine.getCode(), wolfBId);

    const { io, emitted } = fakeIo();
    pushWolfRoomState(io, engine);

    // Every wolf-room member (both wolves) gets their own push.
    const wolfRoomEmits = emitted.filter((e) => e.event === SOCKET_EVENTS.WOLF_ROOM_STATE);
    expect(wolfRoomEmits).toHaveLength(2);

    const payload = wolfRoomEmits[0]!.payload as WolfRoomStatePayload;
    expect(payload.currentVotes).toEqual({ [wolfBId]: villagerId });
    expect(payload.previewVotes).toEqual({ [wolfAId]: villagerId });
    // Confirmed voter's preview must NOT still be showing (cleared above).
    expect(payload.previewVotes[wolfBId]).toBeUndefined();
  });

  it("both fields are empty before anyone has previewed or voted", () => {
    const { engine } = bootToNight1TwoWolves();
    const { io, emitted } = fakeIo();
    pushWolfRoomState(io, engine);
    const payload = emitted.find((e) => e.event === SOCKET_EVENTS.WOLF_ROOM_STATE)!.payload as WolfRoomStatePayload;
    expect(payload.currentVotes).toEqual({});
    expect(payload.previewVotes).toEqual({});
  });
});
