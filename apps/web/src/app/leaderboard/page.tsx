"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";

type LeaderboardCategory = "RATING_GLOBAL" | "RATING_VILLAGE" | "RATING_WOLF" | "RATING_SOLO" | "XP" | "WINS" | "MVP";

interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  value: number;
}

interface LeaderboardResponse {
  category: LeaderboardCategory;
  entries: LeaderboardEntry[];
}

const CATEGORIES: { id: LeaderboardCategory; label: string; unit: string }[] = [
  { id: "RATING_GLOBAL", label: "Rating global", unit: "" },
  { id: "RATING_VILLAGE", label: "Rating Village", unit: "" },
  { id: "RATING_WOLF", label: "Rating Loups", unit: "" },
  { id: "RATING_SOLO", label: "Rating Solo", unit: "" },
  { id: "XP", label: "XP total", unit: "XP" },
  { id: "WINS", label: "Victoires", unit: "" },
  { id: "MVP", label: "MVP", unit: "" },
];

/**
 * Cahier de charge #2 §17.4e. Deliberately public — matches
 * GET /api/leaderboard's own choice to skip requireSession (see
 * apps/server/src/http/leaderboardRoutes.ts): a leaderboard is meant to be
 * seen by everyone, logged in or not. `useAccount()` is only used here to
 * highlight the current viewer's own row, when they have one.
 */
export default function LeaderboardPage() {
  const { account } = useAccount();
  const [category, setCategory] = useState<LeaderboardCategory>("RATING_GLOBAL");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    apiFetch<LeaderboardResponse>(`/api/leaderboard?category=${category}&limit=20`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur inconnue."));
  }, [category]);

  const activeLabel = CATEGORIES.find((c) => c.id === category)!;

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between animate-fade-in">
        <Link href="/" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          ← Accueil
        </Link>
        {account ? (
          <Link href="/profile" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
            Mon profil →
          </Link>
        ) : null}
      </div>

      <section className="card w-full max-w-2xl animate-fade-in">
        <h1 className="font-display text-xl text-gold-300 mb-4">Classements</h1>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                category === c.id
                  ? "border-gold-400 text-gold-300 bg-gold-400/10"
                  : "border-night-100/15 text-night-100/60 hover:text-night-100/90"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card w-full max-w-2xl animate-fade-in">
        {error ? (
          <p className="text-blood-300 text-sm text-center py-4">{error}</p>
        ) : !data ? (
          <p className="text-night-100/50 text-sm text-center py-4 animate-pulse-slow">Un instant…</p>
        ) : data.entries.length === 0 ? (
          <p className="text-night-100/50 text-sm text-center py-4">Pas encore de données pour ce classement.</p>
        ) : (
          <ol className="space-y-1.5">
            {data.entries.map((e) => {
              const isMe = account?.id === e.userId;
              return (
                <li
                  key={e.userId}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                    isMe ? "bg-gold-400/10 border border-gold-400/30" : "border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-right tabular-nums text-night-100/50">
                      {e.rank === 1 ? "🥇" : e.rank === 2 ? "🥈" : e.rank === 3 ? "🥉" : e.rank}
                    </span>
                    <span className={isMe ? "text-gold-300 font-medium" : "text-night-100/90"}>
                      {e.displayName}
                      {isMe ? " (vous)" : ""}
                    </span>
                  </div>
                  <span className="tabular-nums text-night-100/70">
                    {Math.round(e.value)} {activeLabel.unit}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
