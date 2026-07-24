"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emitWithAck } from "@/lib/socket";
import { savePlayerSession } from "@/lib/session";
import { SOCKET_EVENTS } from "@loupgarou/shared";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const gameCode = code.trim().toUpperCase();
      const data = await emitWithAck<{ playerId: string; reconnectToken: string }>(
        SOCKET_EVENTS.PLAYER_JOIN,
        { gameCode, nickname: nickname.trim() },
      );
      savePlayerSession({ gameCode, playerId: data.playerId, reconnectToken: data.reconnectToken, nickname });
      router.push(`/play/${gameCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleJoin} className="card w-full max-w-sm space-y-4 animate-fade-in">
        <h1 className="font-display text-2xl text-gold-300 text-center">Rejoindre la partie</h1>
        <div>
          <label className="text-sm text-night-100/70">Code de la partie</label>
          <input
            className="input mt-1 tracking-widest uppercase text-center text-lg"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABCDE"
            required
          />
        </div>
        <div>
          <label className="text-sm text-night-100/70">Votre pseudo</label>
          <input
            className="input mt-1"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={24}
            placeholder="Ex: Alice"
            required
          />
        </div>
        {error && <p className="text-blood-300 text-sm">{error}</p>}
        <button className="btn-primary w-full" disabled={loading} type="submit">
          {loading ? "Connexion…" : "Rejoindre"}
        </button>
      </form>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
