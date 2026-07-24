import type { Server } from "socket.io";
import { SOCKET_EVENTS, type WolfChatMessagePayload, type WolfRoomStatePayload } from "@loupgarou/shared";
import type { GameEngine } from "@loupgarou/game-engine";
import { roomForPlayer } from "./broadcast.js";

/**
 * The wolf room's membership is recomputed from engine truth every time
 * (never cached), which is what makes Mowgli's transformation "just work":
 * as soon as his roleId flips to LOUP_GAROU, the very next call to
 * getWolfRoomMemberIds() includes him.
 */
export function pushWolfRoomState(io: Server, engine: GameEngine): void {
  const memberIds = engine.getWolfRoomMemberIds();
  if (memberIds.length === 0) return;
  const players = engine.getPlayers();
  const members = memberIds.map((id) => {
    const p = players.find((pl) => pl.id === id)!;
    return { id: p.id, nickname: p.nickname };
  });
  const alivePlayers = players
    .filter((p) => p.isAlive)
    .map((p) => ({ id: p.id, nickname: p.nickname }));

  const payload: WolfRoomStatePayload = { members, alivePlayers, currentVotes: {} };
  for (const id of memberIds) {
    io.to(roomForPlayer(id)).emit(SOCKET_EVENTS.WOLF_ROOM_STATE, payload);
  }
}

export function relayWolfChatMessage(
  io: Server,
  engine: GameEngine,
  senderId: string,
  message: string,
): void {
  const memberIds = engine.getWolfRoomMemberIds();
  if (!memberIds.includes(senderId)) {
    throw new Error("Vous n'avez pas accès au chat des loups.");
  }
  const sender = engine.getPlayers().find((p) => p.id === senderId)!;
  const payload: WolfChatMessagePayload = {
    playerId: sender.id,
    nickname: sender.nickname,
    message: message.slice(0, 500),
    timestamp: Date.now(),
  };
  for (const id of memberIds) {
    io.to(roomForPlayer(id)).emit(SOCKET_EVENTS.WOLF_CHAT_MESSAGE, payload);
  }
}
