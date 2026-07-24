"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { emitWithAck } from "@/lib/socket";
import { saveAdminSession } from "@/lib/session";
import { SOCKET_EVENTS } from "@loupgarou/shared";

export default function AdminLoginPage() {
  const router = useRouter();
  const [adminSecret, setAdminSecret] = useState("");
  const [gameCode, setGameCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await emitWithAck<{ code: string }>(SOCKET_EVENTS.ADMIN_AUTH, {
        adminSecret,
        gameCode: gameCode.trim() ? gameCode.trim().toUpperCase() : undefined,
      });
      saveAdminSession({ adminSecret, gameCode: data.code });
      router.push(`/admin/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4 animate-fade-in">
        <h1 className="font-display text-2xl text-gold-300 text-center">Maître du Jeu</h1>
        <div>
          <label className="text-sm text-night-100/70">Code administrateur</label>
          <input
            type="password"
            className="input mt-1"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-night-100/70">
            Code de partie existante <span className="text-night-600">(laisser vide pour en créer une)</span>
          </label>
          <input
            className="input mt-1 uppercase"
            value={gameCode}
            onChange={(e) => setGameCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
        </div>
        {error && <p className="text-blood-300 text-sm">{error}</p>}
        <button className="btn-primary w-full" disabled={loading} type="submit">
          {loading ? "Connexion…" : gameCode ? "Reprendre la partie" : "Créer une partie"}
        </button>
      </form>
    </main>
  );
}
