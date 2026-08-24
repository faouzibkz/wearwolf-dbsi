"use client";

import { useState } from "react";
import type { WolfChatMessagePayload, WolfRoomStatePayload } from "@loupgarou/shared";
import { SOCKET_EVENTS } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";
import { useResetOnReconnect } from "@/lib/useResetOnReconnect";

export function WolfChat({
  room,
  messages,
}: {
  room: WolfRoomStatePayload;
  messages: WolfChatMessagePayload[];
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useResetOnReconnect(() => {
    setSending(false);
  });

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSendError(null);
    setSending(true);
    try {
      await emitWithAck(SOCKET_EVENTS.WOLF_CHAT_SEND, { message: text });
      setDraft(""); // vidé seulement après confirmation du serveur
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Échec de l'envoi. Réessayez.");
    } finally {
      setSending(false);
    }
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
      {sendError && <p className="text-xs text-blood-300">{sendError}</p>}
      <div className="flex gap-2">
        <input
          className="input"
          value={draft}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Écrire aux autres loups…"
        />
        <button className="btn-primary disabled:opacity-40" onClick={send} disabled={sending}>
          {sending ? "…" : "Envoyer"}
        </button>
      </div>
    </section>
  );
}