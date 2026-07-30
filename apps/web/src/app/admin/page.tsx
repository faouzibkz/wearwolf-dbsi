"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { emitWithAck } from "@/lib/socket";
import { loadAdminSession, saveAdminSession } from "@/lib/session";
import { SOCKET_EVENTS, type AdminAuthResult } from "@loupgarou/shared";

// No password anymore — anyone can create a game with one click. Resuming
// as host of an EXISTING game only works from the same browser that
// created it (via the hostToken saved locally when it was created); there
// is no way to type/share a code to reclaim host of someone else's game,
// by design — that's what keeps a running game's admin view private.
export default function AdminLoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [existingSession, setExistingSession] = useState<{ gameCode: string } | null>(null);

  useEffect(() => {
    const session = loadAdminSession();
    if (session) setExistingSession({ gameCode: session.gameCode });
  }, []);

  async function createGame() {
    setError(null);
    setLoading(true);
    try {
      const data = await emitWithAck<AdminAuthResult>(SOCKET_EVENTS.ADMIN_AUTH, {});
      saveAdminSession({ hostToken: data.hostToken, gameCode: data.code });
      router.push(`/admin/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="card w-full max-w-sm space-y-4 animate-fade-in text-center">
        <h1 className="font-display text-2xl text-gold-300">Maître du Jeu</h1>

        {existingSession && (
          <button
            className="btn-primary w-full"
            onClick={() => router.push(`/admin/${existingSession.gameCode}`)}
          >
            Reprendre la partie {existingSession.gameCode}
          </button>
        )}

        {error && <p className="text-blood-300 text-sm">{error}</p>}

        <button className="btn-primary w-full" disabled={loading} onClick={createGame}>
          {loading ? "Création…" : "Créer une partie"}
        </button>
      </div>
    </main>
  );
}
