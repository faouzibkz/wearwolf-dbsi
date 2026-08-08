import { describe, expect, it, vi } from "vitest";
import { GameEngine } from "@loupgarou/game-engine";
import { SOCKET_EVENTS, type AfterlifeRoomStatePayload, type AfterlifeChatMessagePayload } from "@loupgarou/shared";

// Same reason as broadcast.test.ts: afterlife.ts imports roomForPlayer from
// ./broadcast.js, which also exports broadcastGameState (Prisma-backed,
// via db/persistence.js) — stubbed out so this file doesn't need a
// generated Prisma client in this sandbox (no network access to fetch its
// engine binaries).
vi.mock("../db/persistence.js", () => ({ persistGame: vi.fn() }));

import { pushAfterlifeRoomState, relayAfterlifeChatMessage } from "./afterlife.js";

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

function bootWithOneDeath() {
  const names = ["Chef", "Wolf", "Victim", "V3", "V4"];
  const engine = GameEngine.createGame({ roleCounts: { LOUP_GAROU: 1 } as any });
  const ids: Record<string, string> = {};
  for (const n of names) ids[n] = engine.addPlayer(n).id;
  engine.startGame();
  const roles = new Map(engine.getAdminRoles().map((r) => [r.playerId, r.roleId]));
  const wolfId = names.map((n) => ids[n]!).find((id) => roles.get(id) === "LOUP_GAROU")!;
  // Chef is always ids.Chef (elected below) — excluded up front so the
  // night-kill target can never coincidentally be the elected chief (that
  // would open an unrelated succession blocker this test isn't about).
  const victimId = names.map((n) => ids[n]!).find((id) => id !== wolfId && id !== ids.Chef!)!;

  engine.volunteerForChef(ids.Chef!);
  engine.forceStartChefDebate();
  engine.advanceChefSpeaker();
  for (const n of names.slice(1)) engine.castChefVote(ids[n]!, ids.Chef!);
  engine.tallyChefVoteAndProceed();
  engine.proceedFromChefRevealToDiscussion();
  engine.endDay1Discussion();

  engine.submitNightAction(wolfId, "KILL_VOTE", victimId);
  engine.resolveNightAndProceed();

  return { engine, ids, victimId, wolfId };
}

describe("Afterlife (cahier de charge #2 §17.3)", () => {
  describe("pushAfterlifeRoomState", () => {
    it("emits nothing while everyone is still alive", () => {
      const engine = GameEngine.createGame({ roleCounts: { VILLAGEOIS: 4 } as any });
      for (const n of ["A", "B", "C", "D"]) engine.addPlayer(n);
      const { io, emitted } = fakeIo();
      pushAfterlifeRoomState(io, engine);
      expect(emitted).toHaveLength(0);
    });

    it("broadcasts membership to each dead player's own room once someone dies", () => {
      const { engine, victimId } = bootWithOneDeath();
      // Nicknames ("Chef", "Wolf", "Victim", ...) are just labels — the
      // actual role (and therefore who dies) is assigned randomly across
      // the whole roster, same gotcha documented throughout
      // sequentialNight.test.ts — so the expected nickname is resolved
      // dynamically from the engine rather than assumed from the label.
      const victimNickname = engine.getPlayers().find((p) => p.id === victimId)!.nickname;
      const { io, emitted } = fakeIo();
      pushAfterlifeRoomState(io, engine);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.room).toBe(`player:${victimId}`);
      expect(emitted[0]!.event).toBe(SOCKET_EVENTS.AFTERLIFE_ROOM_STATE);
      const payload = emitted[0]!.payload as AfterlifeRoomStatePayload;
      expect(payload.members).toEqual([{ id: victimId, nickname: victimNickname }]);
    });

    it("never includes a still-alive player in members, even the killer", () => {
      const { engine, wolfId } = bootWithOneDeath();
      const { io, emitted } = fakeIo();
      pushAfterlifeRoomState(io, engine);
      const payload = emitted[0]!.payload as AfterlifeRoomStatePayload;
      expect(payload.members.map((m) => m.id)).not.toContain(wolfId);
    });
  });

  describe("relayAfterlifeChatMessage", () => {
    it("rejects a message from a still-alive player", () => {
      const { engine, wolfId } = bootWithOneDeath();
      const { io } = fakeIo();
      expect(() => relayAfterlifeChatMessage(io, engine, wolfId, "hello")).toThrow();
    });

    it("relays a dead player's message to every dead member's room, truncated to 500 chars", () => {
      const { engine, victimId } = bootWithOneDeath();
      const victimNickname = engine.getPlayers().find((p) => p.id === victimId)!.nickname;
      const { io, emitted } = fakeIo();
      relayAfterlifeChatMessage(io, engine, victimId, "a".repeat(600));

      expect(emitted).toHaveLength(1); // only one dead member (the sender) right now
      expect(emitted[0]!.room).toBe(`player:${victimId}`);
      expect(emitted[0]!.event).toBe(SOCKET_EVENTS.AFTERLIFE_CHAT_MESSAGE);
      const payload = emitted[0]!.payload as AfterlifeChatMessagePayload;
      expect(payload.playerId).toBe(victimId);
      expect(payload.nickname).toBe(victimNickname);
      expect(payload.message).toHaveLength(500);
    });

    it("reaches every dead member, not just the sender, once there are several", () => {
      const { engine, victimId, wolfId } = bootWithOneDeath();
      // A second death: the village unanimously votes out the wolf next
      // (everyone, including the wolf himself, votes for the wolf — no
      // self-vote restriction on the day village vote, unlike the post-game
      // MVP vote — so this can't tie or split).
      engine.proceedFromMorningToDay();
      engine.endDayDiscussion();
      let voterId = engine.getCurrentDayVoterId();
      while (voterId !== null) {
        engine.castDayVote(voterId, wolfId);
        voterId = engine.getCurrentDayVoterId();
      }
      expect(engine.getPublicState().players.find((p) => p.id === wolfId)!.isAlive).toBe(false);

      const { io, emitted } = fakeIo();
      relayAfterlifeChatMessage(io, engine, victimId, "hi everyone");
      const rooms = emitted.map((e) => e.room);
      expect(rooms).toContain(`player:${victimId}`);
      expect(rooms).toContain(`player:${wolfId}`);
      expect(emitted).toHaveLength(2);
    });
  });
});
