"use client";

import { useState } from "react";
import type { AfterlifeChatMessagePayload, AfterlifeRoomStatePayload } from "@loupgarou/shared";
import { SOCKET_EVENTS } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";

/**
 * Cahier de charge #2 §17.3 — modeled directly on WolfChat.tsx. Only ever
 * rendered once the server has actually pushed an AFTERLIFE_ROOM_STATE
 * payload to this socket — invisible to every still-alive player by
 * construction (see apps/server/src/socket/afterlife.ts), same as the wolf
 * room is invisible to non-wolves. Unlike the wolf room, this stays
 * mounted through every later phase, not just NIGHT — a dead player keeps
 * spectating (and chatting about) the rest of the game.
 */
export function AfterlifeChat({
  room,
  messages,
}: {
  room: AfterlifeRoomStatePayload;
  messages: AfterlifeChatMessagePayload[];
}) {
  const [draft, setDraft] = useState("");

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await emitWithAck(SOCKET_EVENTS.AFTERLIFE_CHAT_SEND, { message: text });
  }

  return (
    <section className="card border-night-600/60 space-y-3">
      <h3 className="font-display text-night-100 flex items-center gap-2">
        👻 L&apos;Afterlife
        <span className="text-xs text-night-600 font-body">
          ({room.members.map((m) => m.nickname).join(", ")})
        </span>
      </h3>
      <div className="h-40 overflow-y-auto space-y-1 bg-night-950/50 rounded-lg p-2 text-sm">
        {messages.length === 0 && <p className="text-night-600 italic">Aucun message pour l&apos;instant.</p>}
        {messages.map((m, i) => (
          <p key={i}>
            <span className="text-night-100/80 font-medium">{m.nickname}:</span> {m.message}
          </p>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écrire aux autres défunts…"
        />
        <button className="btn-primary" onClick={send}>
          Envoyer
        </button>
      </div>
    </section>
  );
}
