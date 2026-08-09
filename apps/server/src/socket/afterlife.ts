import type { Server } from "socket.io";
import {
  SOCKET_EVENTS,
  type AfterlifeChatMessagePayload,
  type AfterlifeRoomStatePayload,
} from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { roomForPlayer } from "./broadcast.js";

/**
 * Cahier de charge #2 §17.3 — the Afterlife chat. Deliberately modeled
 * line-for-line on wolfRoom.ts's own pushWolfRoomState/relayWolfChatMessage:
 * membership is recomputed from engine truth every call (never cached),
 * which is what makes a NEW death "just work" — the very next sync() call
 * after someone dies (see GameEngine.getAfterlifeMemberIds) includes them
 * with zero extra wiring. The one real difference from the wolf room: this
 * isn't phase-gated. The wolf room only matters during NIGHT; the
 * Afterlife stays open for the rest of the game once anyone's dead, since
 * a dead player keeps spectating (and presumably wants to keep chatting
 * about) everything that happens in every later phase too — see
 * sync.ts's pushAllPrompts, which calls pushAfterlifeRoomState
 * unconditionally rather than inside the `if (phase === "NIGHT")` block.
 */
export function pushAfterlifeRoomState(io: Server, engine: GameEngine): void {
  const memberIds = engine.getAfterlifeMemberIds();
  if (memberIds.length === 0) return;
  const players = engine.getPlayers();
  const members = memberIds.map((id) => {
    const p = players.find((pl) => pl.id === id)!;
    return { id: p.id, nickname: p.nickname };
  });
  // Full information for the dead: every player's true role, alive or not.
  // Safe specifically BECAUSE this payload only ever reaches roomForPlayer(id)
  // for ids already in memberIds below — see the doc comment on
  // AfterlifeRoomStatePayload.allPlayers.
  const allPlayers = players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    roleId: p.roleId,
    isAlive: p.isAlive,
  }));

  const payload: AfterlifeRoomStatePayload = { members, allPlayers };
  for (const id of memberIds) {
    io.to(roomForPlayer(id)).emit(SOCKET_EVENTS.AFTERLIFE_ROOM_STATE, payload);
  }
}

export function relayAfterlifeChatMessage(
  io: Server,
  engine: GameEngine,
  senderId: string,
  message: string,
): void {
  const memberIds = engine.getAfterlifeMemberIds();
  if (!memberIds.includes(senderId)) {
    throw new Error("Vous n'avez pas accès au chat de l'Afterlife.");
  }
  const sender = engine.getPlayers().find((p) => p.id === senderId)!;
  const payload: AfterlifeChatMessagePayload = {
    playerId: sender.id,
    nickname: sender.nickname,
    message: message.slice(0, 500),
    timestamp: Date.now(),
  };
  for (const id of memberIds) {
    io.to(roomForPlayer(id)).emit(SOCKET_EVENTS.AFTERLIFE_CHAT_MESSAGE, payload);
  }
}
