"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";

interface UnlockedBadge {
  id: string;
  name: string;
  description: string;
  secret: boolean;
  unlockedAt: string;
}

interface LockedBadge {
  id: string;
  name: string;
  description: string;
}

interface BadgesData {
  unlocked: UnlockedBadge[];
  locked: LockedBadge[];
  secretLockedCount: number;
  totalBadgeCount: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Cahier de charge #2 §17.4d. Data comes from GET /api/badges/me (see
 * apps/server/src/http/badgeRoutes.ts) — badge METADATA always lives in
 * apps/server/src/badges/deriveBadges.ts's BADGE_REGISTRY (code, not a DB
 * table), this page just renders whatever that endpoint hands back.
 */
export default function AchievementsPage() {
  const router = useRouter();
  const { account } = useAccount();
  const [data, setData] = useState<BadgesData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account === null) {
      router.replace("/login?returnTo=/achievements");
      return;
    }
    if (account === undefined) return;
    apiFetch<BadgesData>("/api/badges/me")
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

  const { unlocked, locked, secretLockedCount, totalBadgeCount } = data;
  const unlockedCount = unlocked.length;
  const progressPct = totalBadgeCount > 0 ? Math.round((unlockedCount / totalBadgeCount) * 100) : 0;

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between animate-fade-in">
        <Link href="/profile" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          ← Profil
        </Link>
        <Link href="/history" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          Historique des parties →
        </Link>
      </div>

      <section className="card w-full max-w-2xl animate-fade-in">
        <div className="flex items-center justify-between mb-2">
          <h1 className="font-display text-xl text-gold-300">Succès</h1>
          <span className="text-xs text-night-100/50">
            {unlockedCount} / {totalBadgeCount} débloqués
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-night-900/60 overflow-hidden">
          <div
            className="h-full bg-gold-400 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </section>

      {/* Unlocked — includes secret badges, in full, once earned; sorted
          newest-first by the server (unlockedAt desc). */}
      <section className="card w-full max-w-2xl animate-fade-in">
        <h2 className="font-display text-lg text-gold-300 mb-3">Débloqués</h2>
        {unlocked.length === 0 ? (
          <p className="text-sm text-night-100/50 text-center py-4">
            Aucun succès débloqué pour l&apos;instant — jouez une partie pour commencer !
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {unlocked.map((b) => (
              <li key={b.id} className="rounded-lg border border-gold-400/30 bg-gold-400/5 p-3">
                <div className="flex items-center gap-2 text-sm text-gold-300 font-medium">
                  <span>{b.secret ? "🌟" : "🏆"}</span>
                  <span>{b.name}</span>
                </div>
                <p className="text-xs text-night-100/60 mt-1">{b.description}</p>
                <p className="text-[11px] text-night-100/40 mt-2">Débloqué le {formatDate(b.unlockedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Locked — non-secret only. Secret badges never show their name or
          description before they're earned (that's the whole point), just
          a count of how many are still out there to find. */}
      <section className="card w-full max-w-2xl animate-fade-in">
        <h2 className="font-display text-lg text-gold-300 mb-3">À débloquer</h2>
        {locked.length === 0 && secretLockedCount === 0 ? (
          <p className="text-sm text-night-100/50 text-center py-4">
            Vous avez débloqué tous les succès connus. Bravo !
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {locked.map((b) => (
              <li key={b.id} className="rounded-lg border border-night-100/10 p-3 opacity-70">
                <div className="flex items-center gap-2 text-sm text-night-100/80 font-medium">
                  <span>🔒</span>
                  <span>{b.name}</span>
                </div>
                <p className="text-xs text-night-100/50 mt-1">{b.description}</p>
              </li>
            ))}
            {secretLockedCount > 0 &&
              Array.from({ length: secretLockedCount }).map((_, i) => (
                <li key={`secret-${i}`} className="rounded-lg border border-night-100/10 p-3 opacity-50">
                  <div className="flex items-center gap-2 text-sm text-night-100/60 font-medium">
                    <span>❓</span>
                    <span>Succès secret</span>
                  </div>
                  <p className="text-xs text-night-100/40 mt-1">
                    Continuez à jouer pour découvrir comment le débloquer…
                  </p>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
