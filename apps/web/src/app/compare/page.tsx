"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";

interface ProfileData {
  user: { id: string; username: string; displayName: string; createdAt: string };
  stats: {
    gamesPlayed: number;
    gamesWon: number;
    winRate: number;
    longestWinStreak: number;
    averageNightsSurvived: number;
  };
  ratings: { global: number; village: number; wolf: number; solo: number };
  progression: { totalXp: number; level: number; mvpCount: number };
  badgeCount: number;
}

interface ComparisonRow {
  label: string;
  mine: number;
  theirs: number;
  /** Higher is better for every row here — none of these stats are the kind where "less" wins. */
  format?: (n: number) => string;
}

function buildRows(mine: ProfileData, theirs: ProfileData): ComparisonRow[] {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const round = (n: number) => `${Math.round(n)}`;
  return [
    { label: "Rating global", mine: mine.ratings.global, theirs: theirs.ratings.global, format: round },
    { label: "Rating Village", mine: mine.ratings.village, theirs: theirs.ratings.village, format: round },
    { label: "Rating Loups", mine: mine.ratings.wolf, theirs: theirs.ratings.wolf, format: round },
    { label: "Rating Solo", mine: mine.ratings.solo, theirs: theirs.ratings.solo, format: round },
    { label: "Niveau", mine: mine.progression.level, theirs: theirs.progression.level },
    { label: "XP total", mine: mine.progression.totalXp, theirs: theirs.progression.totalXp },
    { label: "MVP", mine: mine.progression.mvpCount, theirs: theirs.progression.mvpCount },
    { label: "Parties jouées", mine: mine.stats.gamesPlayed, theirs: theirs.stats.gamesPlayed },
    { label: "Taux de victoire", mine: mine.stats.winRate, theirs: theirs.stats.winRate, format: pct },
    { label: "Meilleure série de victoires", mine: mine.stats.longestWinStreak, theirs: theirs.stats.longestWinStreak },
    { label: "Succès débloqués", mine: mine.badgeCount, theirs: theirs.badgeCount },
  ];
}

/**
 * Cahier de charge #2 §17.4f ("comparaison de profils"). Both sides render
 * from the exact same shape (see accountRoutes.ts's buildPublicProfile) —
 * "mine" from GET /api/profile/me, "theirs" from the new public
 * GET /api/profile/:username, keyed by whatever the user types in.
 */
export default function ComparePage() {
  const router = useRouter();
  const { account } = useAccount();
  const [username, setUsername] = useState("");
  const [submittedUsername, setSubmittedUsername] = useState<string | null>(null);
  const [mine, setMine] = useState<ProfileData | null>(null);
  const [theirs, setTheirs] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (account === null) {
      router.replace("/login?returnTo=/compare");
      return;
    }
    if (account === undefined) return;
    apiFetch<ProfileData>("/api/profile/me").then(setMine).catch(() => {});
  }, [account, router]);

  function handleCompare(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    setError(null);
    setTheirs(null);
    setLoading(true);
    setSubmittedUsername(trimmed);
    apiFetch<ProfileData>(`/api/profile/${encodeURIComponent(trimmed)}`)
      .then(setTheirs)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur inconnue."))
      .finally(() => setLoading(false));
  }

  if (account === undefined || account === null) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-night-100/50 text-sm animate-pulse-slow">Un instant…</p>
      </main>
    );
  }

  const rows = mine && theirs ? buildRows(mine, theirs) : null;

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between animate-fade-in">
        <Link href="/profile" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          ← Profil
        </Link>
        <Link href="/leaderboard" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          Classements →
        </Link>
      </div>

      <section className="card w-full max-w-2xl animate-fade-in">
        <h1 className="font-display text-xl text-gold-300 mb-4">Comparer les profils</h1>
        <form onSubmit={handleCompare} className="flex gap-2">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Pseudo d'un autre joueur…"
            className="flex-1 rounded-lg bg-night-900/60 border border-night-100/15 px-3 py-2 text-sm text-night-100/90 placeholder:text-night-100/30 focus:outline-none focus:border-gold-400/50"
          />
          <button type="submit" className="btn-primary text-sm px-4 py-2" disabled={loading || !username.trim()}>
            {loading ? "…" : "Comparer"}
          </button>
        </form>
        {error ? <p className="text-blood-300 text-xs mt-2">{error}</p> : null}
      </section>

      {rows && mine && theirs ? (
        <section className="card w-full max-w-2xl animate-fade-in">
          <div className="grid grid-cols-3 text-sm font-medium text-night-100/70 mb-3">
            <span>{mine.user.displayName} (vous)</span>
            <span className="text-center text-night-100/40">vs</span>
            <span className="text-right">{theirs.user.displayName}</span>
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const format = r.format ?? ((n: number) => `${n}`);
              const mineWins = r.mine > r.theirs;
              const theirsWins = r.theirs > r.mine;
              return (
                <li key={r.label} className="grid grid-cols-3 items-center text-sm py-1 border-t border-night-100/10 first:border-t-0 first:pt-0">
                  <span className={mineWins ? "text-gold-300 font-medium" : "text-night-100/80"}>{format(r.mine)}</span>
                  <span className="text-center text-[11px] text-night-100/40">{r.label}</span>
                  <span className={`text-right ${theirsWins ? "text-gold-300 font-medium" : "text-night-100/80"}`}>
                    {format(r.theirs)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : submittedUsername && !loading && !error ? (
        <p className="text-night-100/50 text-sm">Introuvable.</p>
      ) : null}
    </main>
  );
}
