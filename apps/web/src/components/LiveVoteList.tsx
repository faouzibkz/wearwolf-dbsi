"use client";

import { useState } from "react";
import type { PlayerPublic } from "@loupgarou/shared";

/**
 * The day elimination vote is an open ballot: every player sees, live, how
 * many votes each candidate has and exactly who cast them.
 *
 * Two deliberate anti-manipulation rules, both enforced here on top of the
 * server-side lock in castDayVote/castChefVote:
 *  - The row order is STABLE (whatever order `candidates` arrives in — join
 *    order from the server), never re-sorted by vote count. A live-reordering
 *    list made it easy to rage-bait a last-second pile-on by literally
 *    showing who's "winning."
 *  - Voting is two-tap: the first tap arms a candidate (highlighted, with a
 *    "tap again to confirm" prompt); a second tap on the SAME candidate
 *    actually casts the vote and locks it. This protects against a
 *    misclick turning into a permanent, unchangeable vote (the server
 *    itself only accepts one vote per player per round — this is the UX
 *    safety net in front of that hard rule, not a replacement for it).
 */
export function LiveVoteList({
  candidates,
  allPlayers,
  dayVotes,
  dayVoteTally,
  myId,
  interactive,
  onSelect,
  isConnected = true,
}: {
  candidates: PlayerPublic[];
  allPlayers: PlayerPublic[];
  dayVotes: Record<string, string>;
  /** Weighted vote count per target — the Chef's vote counts double while active, so use this for the number/bar, not voterIds.length. */
  dayVoteTally: Record<string, number>;
  myId: string | null;
  /** false for spectators/dead players: they see the live tally, but can't vote. */
  interactive: boolean;
  onSelect: (id: string) => Promise<void>;
  /**
   * 18 août 2026 — when false (socket currently down), voting is disabled
   * and a banner explains why, instead of letting a tap arm/confirm a vote
   * that's guaranteed to time out. See play/[code]/page.tsx's
   * socketConnected tracking and NightPromptPanel's identical treatment.
   */
  isConnected?: boolean;
}) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nicknameOf = (id: string) => allPlayers.find((p) => p.id === id)?.nickname ?? "?";
  const myVoteTargetId = myId ? dayVotes[myId] : undefined;
  const locked = Boolean(myVoteTargetId) || submitting || !isConnected;

  const maxWeight = Math.max(1, ...candidates.map((c) => dayVoteTally[c.id] ?? 0));

  return (
    <ul className="space-y-2">
      {!isConnected && (
        <p className="text-sm text-gold-300 bg-gold-500/10 border border-gold-500/30 rounded-lg px-3 py-2 text-center mb-2">
          🔌 Connexion perdue — reconnexion en cours… Votre vote ne peut pas être envoyé pour l'instant.
        </p>
      )}
      {error && <p className="text-xs text-blood-300 text-center -mt-1 mb-2">{error}</p>}
      {candidates.map((player) => {
        const voterIds = Object.entries(dayVotes)
          .filter(([, targetId]) => targetId === player.id)
          .map(([voterId]) => voterId);
        const weight = dayVoteTally[player.id] ?? 0;
        const isMyVote = myVoteTargetId === player.id;
        const isArmed = armedId === player.id;
        const clickable = interactive && player.isAlive && !locked;

        return (
          <li
            key={player.id}
            onClick={async () => {
              if (!clickable) return;
              setError(null);
              if (armedId !== player.id) {
                // First tap: arm this candidate, don't vote yet.
                setArmedId(player.id);
                return;
              }
              // Second tap on the same candidate: confirm and cast.
              setSubmitting(true);
              try {
                await onSelect(player.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Le vote a échoué, réessayez.");
                setSubmitting(false);
                setArmedId(null);
              }
            }}
            className={[
              "rounded-lg border px-3 py-2 transition-all duration-300",
              isMyVote
                ? "border-blood-400 bg-blood-500/20"
                : isArmed
                  ? "border-gold-400 bg-gold-400/10"
                  : "border-night-700 bg-night-800/70",
              clickable ? "cursor-pointer hover:border-gold-400/60" : "opacity-50 cursor-not-allowed",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`truncate font-medium ${!player.isAlive ? "line-through" : ""}`}>
                {player.nickname}
              </span>
              <span
                className={`shrink-0 font-display text-sm tabular-nums transition-colors ${
                  weight > 0 ? "text-gold-300" : "text-night-600"
                }`}
              >
                {weight} vote{weight !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-night-900/60 overflow-hidden">
              <div
                className="h-full bg-blood-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(weight / maxWeight) * 100}%` }}
              />
            </div>
            {isArmed && !isMyVote && (
              <p className="mt-1.5 text-xs text-gold-300 animate-pulse-slow">
                Touchez à nouveau pour confirmer votre vote.
              </p>
            )}
            {isMyVote && <p className="mt-1.5 text-xs text-blood-300">🔒 Votre vote (verrouillé)</p>}
            {voterIds.length > 0 && (
              <p className="mt-1.5 text-xs text-night-100/60 truncate">
                {voterIds.map((id) => {
                  const isChefVoter = allPlayers.find((p) => p.id === id)?.isChef;
                  return isChefVoter ? `👑 ${nicknameOf(id)}` : nicknameOf(id);
                }).join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
