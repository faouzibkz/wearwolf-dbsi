"use client";

import { useState } from "react";
import type { PlayerPublic } from "@loupgarou/shared";
import { useResetOnReconnect } from "@/lib/useResetOnReconnect";

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
  dayVoteTally: Record<string, number>;
  myId: string | null;
  interactive: boolean;
  onSelect: (id: string) => Promise<void>;
  isConnected?: boolean;
}) {
  const [armedId, setArmedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useResetOnReconnect(() => {
    setSubmitting(false);
  });

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
      {submitting && (
        <p className="text-xs text-gold-300/70 text-center animate-pulse-slow mb-2">
          ⏳ Envoi du vote en cours…
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
                setArmedId(player.id);
                return;
              }
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
              "select-none touch-manipulation [&_*]:pointer-events-none",
              isMyVote
                ? "border-blood-400 bg-blood-500/20"
                : isArmed
                  ? "border-gold-400 bg-gold-400/10"
                  : "border-night-700 bg-night-800/70",
              clickable ? "cursor-pointer hover:border-gold-400/60 active:scale-[0.98]" : "opacity-50 cursor-not-allowed",
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