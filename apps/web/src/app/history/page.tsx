"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/lib/auth";
import { apiFetch, ApiError } from "@/lib/api";

interface HistoryEntry {
  gameId: string;
  code: string;
  name: string;
  playedAt: string;
  playerCount: number;
  nickname: string;
  roleId: string;
  team: string | null;
  result: "WON" | "LOST" | "DRAW" | null;
  isAlive: boolean;
  deathCause: string | null;
  deathMoment: string | null;
  winner: string | null;
}

interface HistoryData {
  total: number;
  games: HistoryEntry[];
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

// Presentation-only duplicate of the (French) labels the engine's admin log
// uses internally (see packages/game-engine/src/engine/DeathQueue.ts) —
// this is just for a friendlier history page and never drives any logic.
const CAUSE_LABELS: Record<string, string> = {
  LOUP_GAROU_ATTACK: "attaqué par les loups-garous",
  LOUP_BLANC_ATTACK: "dévoré par le loup blanc",
  SORCIERE_POISON: "empoisonné par la sorcière",
  CHASSEUR_SHOT: "abattu par le chasseur",
  VOTE_ELIMINATION: "éliminé par le village",
  ALIEN_GUESS_CORRECT: "deviné par l'Alien",
  ALIEN_OUT_OF_CHANCES: "mort — plus aucune chance",
  BARBIE_REVEAL_WOLF: "démasqué par Barbie",
  BARBIE_REVEAL_MISFIRE: "emporté par le pouvoir de Barbie",
};

const TEAM_LABELS: Record<string, string> = { VILLAGE: "Village", LOUPS: "Loups", SOLO: "Solitaire" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { year: "numeric", month: "short", day: "numeric" });
}

function ResultBadge({ result }: { result: HistoryEntry["result"] }) {
  if (result === "WON") {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gold-400/15 text-gold-300 border border-gold-400/40">Victoire</span>;
  }
  if (result === "LOST") {
    return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blood-500/15 text-blood-300 border border-blood-400/40">Défaite</span>;
  }
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-night-700 text-night-100/60 border border-night-600">Match nul</span>;
}

const PAGE_SIZE = 10;

export default function HistoryPage() {
  const router = useRouter();
  const { account } = useAccount();
  const [data, setData] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback((newOffset: number) => {
    setLoading(true);
    apiFetch<HistoryData>(`/api/history/me?limit=${PAGE_SIZE}&offset=${newOffset}`)
      .then((d) => {
        setData(d);
        setOffset(newOffset);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Erreur inconnue."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (account === null) {
      router.replace("/login?returnTo=/history");
      return;
    }
    if (account === undefined) return;
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, router]);

  if (account === undefined || account === null || (!data && !error)) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-night-100/50 text-sm animate-pulse-slow">Un instant…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-blood-300 text-sm">{error}</p>
      </main>
    );
  }

  const games = data?.games ?? [];
  const total = data?.total ?? 0;
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <main className="min-h-screen px-6 py-10 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between animate-fade-in">
        <Link href="/profile" className="text-night-100/50 hover:text-gold-300 text-sm transition-colors">
          ← Profil
        </Link>
        <h1 className="font-display text-xl text-gold-300">Historique des parties</h1>
        <span className="text-xs text-night-100/40">{total} au total</span>
      </div>

      <section className={`w-full max-w-2xl space-y-3 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
        {games.length === 0 ? (
          <div className="card text-center py-8 text-night-100/50 text-sm animate-fade-in">
            Aucune partie terminée pour le moment. Une fois vos parties finies, elles apparaîtront ici.
          </div>
        ) : (
          games.map((g) => (
            <div key={g.gameId} className="card animate-fade-in">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-night-50">{g.name}</span>
                    <span className="text-xs text-night-100/40 tracking-widest">{g.code}</span>
                  </div>
                  <p className="text-xs text-night-100/50 mt-0.5">
                    {formatDate(g.playedAt)} · {g.playerCount} joueurs · pseudo « {g.nickname} »
                  </p>
                </div>
                <ResultBadge result={g.result} />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-night-100/80">
                  {ROLE_LABELS[g.roleId] ?? g.roleId}
                  {g.team && <span className="text-night-100/40"> · {TEAM_LABELS[g.team] ?? g.team}</span>}
                </span>
                <span className="text-xs text-night-100/50">
                  {g.isAlive
                    ? "Survivant jusqu'à la fin"
                    : `Mort${g.deathMoment ? ` (${g.deathMoment})` : ""}${
                        g.deathCause ? ` — ${CAUSE_LABELS[g.deathCause] ?? g.deathCause}` : ""
                      }`}
                </span>
              </div>
            </div>
          ))
        )}
      </section>

      {(hasPrev || hasNext) && (
        <div className="flex gap-3">
          <button
            className="btn-secondary text-sm px-4 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!hasPrev || loading}
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
          >
            ← Plus récent
          </button>
          <button
            className="btn-secondary text-sm px-4 py-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
            disabled={!hasNext || loading}
            onClick={() => load(offset + PAGE_SIZE)}
          >
            Plus ancien →
          </button>
        </div>
      )}
    </main>
  );
}
