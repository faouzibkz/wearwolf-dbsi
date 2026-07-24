"use client";

import { useState } from "react";
import type { WolfChatMessagePayload, WolfRoomStatePayload } from "@loupgarou/shared";
import { SOCKET_EVENTS } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";

/**
 * Only ever rendered when the server has pushed a WOLF_ROOM_STATE payload
 * to this socket — invisible to every non-wolf player by construction
 * (see apps/server/src/socket/wolfRoom.ts).
 */
export function WolfChat({
  room,
  messages,
}: {
  room: WolfRoomStatePayload;
  messages: WolfChatMessagePayload[];
}) {
  const [draft, setDraft] = useState("");

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await emitWithAck(SOCKET_EVENTS.WOLF_CHAT_SEND, { message: text });
  }

  return (
    <section className="card border-blood-500/40 space-y-3">
      <h3 className="font-display text-blood-300 flex items-center gap-2">
        🐺 Repaire des loups
        <span className="text-xs text-night-600 font-body">({room.members.map((m) => m.nickname).join(", ")})</span>
      </h3>
      <div className="h-40 overflow-y-auto space-y-1 bg-night-950/50 rounded-lg p-2 text-sm">
        {messages.length === 0 && <p className="text-night-600 italic">Aucun message pour l&apos;instant.</p>}
        {messages.map((m, i) => (
          <p key={i}>
            <span className="text-blood-300 font-medium">{m.nickname}:</span> {m.message}
          </p>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écrire aux autres loups…"
        />
        <button className="btn-primary" onClick={send}>
          Envoyer
        </button>
      </div>
    </section>
  );
}
