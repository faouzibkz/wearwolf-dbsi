"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emitWithAck } from "@/lib/socket";
import { savePlayerSession } from "@/lib/session";
import { useAccount } from "@/lib/auth";
import { SOCKET_EVENTS } from "@loupgarou/shared";

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { account } = useAccount();
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Only ever auto-fill the pseudo field ONCE, when the account first
  // resolves — if we kept syncing it we'd stomp on whatever the person
  // typed the moment `account` re-renders for an unrelated reason.
  const prefilledRef = useRef(false);

  useEffect(() => {
    // Not logged in: every player needs a permanent account (spec section
    // 1) before joining, so stats/history have somewhere to attach. Bounce
    // to /login, remembering exactly where to come back to.
    if (account === null) {
      const code = params.get("code");
      const returnTo = `/join${code ? `?code=${code}` : ""}`;
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    }
  }, [account, params, router]);

  useEffect(() => {
    if (account && !prefilledRef.current) {
      prefilledRef.current = true;
      setNickname(account.displayName);
    }
  }, [account]);

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

  // Either the initial /api/auth/me check is still in flight, or we're
  // about to redirect to /login (see the effect above) — either way,
  // nothing useful to show yet.
  if (account === undefined || account === null) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-night-100/50 text-sm animate-pulse-slow">Un instant…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={handleJoin} className="card w-full max-w-sm space-y-4 animate-fade-in">
        <h1 className="font-display text-2xl text-gold-300 text-center">Rejoindre la partie</h1>
        <p className="text-center text-xs text-night-100/50 -mt-2">
          Connecté comme <span className="text-night-100/80">{account.username}</span>
        </p>
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
          <label className="text-sm text-night-100/70">Votre pseudo pour cette partie</label>
          <input
            className="input mt-1"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={24}
            placeholder="Ex: Dark Lord, La Banane…"
            required
          />
          <p className="text-xs text-night-100/40 mt-1">
            Juste pour cette partie — vos statistiques restent liées à votre compte ({account.username}), jamais à ce
            pseudo.
          </p>
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
