"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";

interface RoleStat {
  roleId: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

interface ProfileData {
  user: { id: string; username: string; displayName: string; createdAt: string };
  stats: { gamesPlayed: number; gamesWon: number; gamesLost: number; winRate: number; perRole: RoleStat[] };
}

const ROLE_LABELS: Record<string, string> = {
  VILLAGEOIS: "Villageois",
  LOUP_GAROU: "Loup-Garou",
  LOUP_BLANC: "Loup Blanc",
  LOUP_VERT: "Loup Vert",
  SORCIERE: "Sorcière",
  VOYANTE: "Voyante",
  SALVATEUR: "Salvateur",
  CHASSEUR: "Chasseur",
  CORBEAU: "Corbeau",
  MOWGLI: "Mowgli",
  BARBIE: "Barbie",
  ALIEN: "Alien",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

export default function ProfilePage() {
  const router = useRouter();
  const { account } = useAccount();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account === null) {
      router.replace("/login?returnTo=/profile");
      return;
    }
    if (account === undefined) return;
    apiFetch<ProfileData>("/api/profile/me")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur inconnue."));
  }, [account, router]);

  if (account === undefined || account === null || (!data && !error)) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-night-100/50 text-sm animate-pulse-slow">Un instant…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-blood-300 text-sm">{error ?? "Erreur inconnue."}</p>
      </main>
    );
  }

  const { user, stats } = data;
  const winRatePct = Math.round(stats.winRate * 100);

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between animate-fade-in">
        <Link href="/" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          ← Accueil
        </Link>
        <Link href="/history" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          Historique des parties →
        </Link>
      </div>

      {/* Identity card */}
      <section className="card w-full max-w-2xl flex items-center gap-4 animate-fade-in">
        <div className="w-16 h-16 rounded-full bg-blood-500/80 flex items-center justify-center font-display text-2xl text-white shrink-0 glow-gold">
          {user.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-xl text-gold-300">{user.displayName}</h1>
          <p className="text-sm text-night-100/50">
            @{user.username} — membre depuis le {formatDate(user.createdAt)}
          </p>
        </div>
      </section>

      {/* Headline stats (spec section 4 minimum set) */}
      <section className="w-full max-w-2xl grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in">
        {[
          { label: "Parties jouées", value: stats.gamesPlayed },
          { label: "Victoires", value: stats.gamesWon },
          { label: "Défaites", value: stats.gamesLost },
          { label: "Taux de victoire", value: `${winRatePct}%` },
        ].map((s) => (
          <div key={s.label} className="card text-center py-4">
            <div className="font-display text-2xl text-gold-300">{s.value}</div>
            <div className="text-xs text-night-100/50 mt-1">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Per-role breakdown — purely data-driven: whatever roleIds show up
          in this account's history render here automatically (see spec
          section 16), with a friendly label when we have one and the raw
          id as a graceful fallback for any future role. */}
      <section className="card w-full max-w-2xl animate-fade-in">
        <h2 className="font-display text-lg text-gold-300 mb-3">Par rôle</h2>
        {stats.perRole.length === 0 ? (
          <p className="text-sm text-night-100/50 text-center py-4">
            Pas encore de partie terminée — jouez-en une pour voir vos stats apparaître ici !
          </p>
        ) : (
          <ul className="space-y-3">
            {stats.perRole.map((r) => {
              const pct = r.games > 0 ? Math.round((r.wins / r.games) * 100) : 0;
              return (
                <li key={r.roleId}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-night-100/90">{ROLE_LABELS[r.roleId] ?? r.roleId}</span>
                    <span className="text-night-100/50 tabular-nums">
                      {r.games} partie{r.games !== 1 ? "s" : ""} · {r.wins}V / {r.losses}D · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-night-900/60 overflow-hidden">
                    <div
                      className="h-full bg-gold-400 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
