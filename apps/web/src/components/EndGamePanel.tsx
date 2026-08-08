"use client";

import { useState } from "react";
import type { EndGameStats, MvpResultPayload, MvpStatePayload } from "@loupgarou/shared";
import { SOCKET_EVENTS } from "@loupgarou/shared";
import { emitWithAck } from "@/lib/socket";
import { RoleCard } from "./RoleCard";

interface EndGamePanelProps {
  stats: unknown;
  myPlayerId: string;
  mvpState: MvpStatePayload | null;
  mvpResult: MvpResultPayload | null;
}

export function EndGamePanel({ stats, myPlayerId, mvpState, mvpResult }: EndGamePanelProps) {
  const s = stats as EndGameStats;
  return (
    <section className="space-y-6 animate-fade-in">
      <div className="text-center">
        <p className="text-5xl mb-2">{s.winner === "VILLAGE" ? "🏆🧑‍🌾" : "🏆🐺"}</p>
        <h2 className="font-display text-2xl text-gold-300">
          {s.winner === "VILLAGE" ? "Le village l'emporte !" : "Les loups-garous l'emportent !"}
        </h2>
        <p className="text-sm text-night-100/60 mt-1">
          {s.totalNights} nuit(s) · {s.totalDays} jour(s)
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {s.roleReveal.map((r) => (
          <div key={r.playerId} className={r.isAlive ? "" : "opacity-60"}>
            <RoleCard roleId={r.roleId} compact />
            <p className="text-center text-sm mt-1 text-night-100/80">
              {r.nickname} {!r.isAlive && "†"}
              {mvpResult?.winners.some((w) => w.playerId === r.playerId) && " 🏅"}
            </p>
          </div>
        ))}
      </div>
      <MvpVotePanel roleReveal={s.roleReveal} myPlayerId={myPlayerId} mvpState={mvpState} mvpResult={mvpResult} />
    </section>
  );
}

/**
 * Post-game MVP vote (cahier de charge section 12). Deliberately a single,
 * one-time choice from this client's point of view once it succeeds — the
 * server (mvp/mvpVotingRegistry.ts) technically allows re-voting, but
 * exposing a "change my vote" UI wasn't part of what was asked for, so
 * this keeps it simple: cast once, then just watch the tally progress.
 */
function MvpVotePanel({
  roleReveal,
  myPlayerId,
  mvpState,
  mvpResult,
}: {
  roleReveal: EndGameStats["roleReveal"];
  myPlayerId: string;
  mvpState: MvpStatePayload | null;
  mvpResult: MvpResultPayload | null;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myChoice, setMyChoice] = useState<string | null>(null);

  if (mvpResult) {
    const names = mvpResult.winners.map((w) => w.nickname);
    return (
      <div className="card text-center py-4 animate-fade-in">
        <p className="font-display text-lg text-gold-300">
          🏅 {names.length === 0 ? "Personne n'a voté — pas de MVP cette partie." : names.length === 1 ? `MVP de la partie : ${names[0]}` : `MVP de la partie (ex æquo) : ${names.join(", ")}`}
        </p>
      </div>
    );
  }

  // Server is the source of truth for "have I voted" (mvpState.votedPlayerIds),
  // but that arrives one round-trip after our own click — myChoice covers
  // that brief gap so the button disables immediately, not just eventually.
  const hasVoted = myChoice !== null || (mvpState?.votedPlayerIds.includes(myPlayerId) ?? false);
  const votable = roleReveal.filter((r) => r.playerId !== myPlayerId);

  async function vote(votedForId: string) {
    setSubmitting(true);
    setError(null);
    try {
      await emitWithAck(SOCKET_EVENTS.MVP_VOTE_CAST, { votedForId });
      setMyChoice(votedForId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-3 animate-fade-in">
      <h3 className="font-display text-gold-300 text-center">🏅 Votez pour le MVP de la partie</h3>
      {error && <p className="text-blood-300 text-sm text-center">{error}</p>}
      {hasVoted ? (
        <p className="text-sm text-night-100/60 text-center">
          Vote enregistré — en attente des autres joueurs
          {mvpState ? ` (${mvpState.votesCast}/${mvpState.totalEligible})` : ""}…
        </p>
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          {votable.map((r) => (
            <button
              key={r.playerId}
              className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40"
              disabled={submitting}
              onClick={() => vote(r.playerId)}
            >
              {r.nickname}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
