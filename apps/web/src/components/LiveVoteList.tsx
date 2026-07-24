"use client";

import type { PlayerPublic } from "@loupgarou/shared";

/**
 * The day elimination vote is an open ballot: every player sees, live, how
 * many votes each candidate has and exactly who cast them. Rows re-sort by
 * vote count as votes come in (or change), with an animated bar so a shift
 * is visible even without reading numbers.
 */
export function LiveVoteList({
  candidates,
  allPlayers,
  dayVotes,
  myId,
  interactive,
  onSelect,
}: {
  candidates: PlayerPublic[];
  allPlayers: PlayerPublic[];
  dayVotes: Record<string, string>;
  myId: string | null;
  /** false for spectators/dead players: they see the live tally, but can't vote. */
  interactive: boolean;
  onSelect: (id: string) => void;
}) {
  const nicknameOf = (id: string) => allPlayers.find((p) => p.id === id)?.nickname ?? "?";
  const myVoteTargetId = myId ? dayVotes[myId] : undefined;

  const rows = candidates
    .map((player) => {
      const voterIds = Object.entries(dayVotes)
        .filter(([, targetId]) => targetId === player.id)
        .map(([voterId]) => voterId);
      return { player, voterIds };
    })
    .sort((a, b) => b.voterIds.length - a.voterIds.length);

  const maxVotes = Math.max(1, ...rows.map((r) => r.voterIds.length));

  return (
    <ul className="space-y-2">
      {rows.map(({ player, voterIds }) => {
        const clickable = interactive && player.isAlive;
        const isMyVote = myVoteTargetId === player.id;
        const count = voterIds.length;
        return (
          <li
            key={player.id}
            onClick={() => clickable && onSelect(player.id)}
            className={[
              "rounded-lg border px-3 py-2 transition-all duration-300",
              isMyVote ? "border-blood-400 bg-blood-500/20" : "border-night-700 bg-night-800/70",
              clickable ? "cursor-pointer hover:border-gold-400/60" : "opacity-50 cursor-not-allowed",
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`truncate font-medium ${!player.isAlive ? "line-through" : ""}`}>
                {player.nickname}
              </span>
              <span
                className={`shrink-0 font-display text-sm tabular-nums transition-colors ${
                  count > 0 ? "text-gold-300" : "text-night-600"
                }`}
              >
                {count} vote{count !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-night-900/60 overflow-hidden">
              <div
                className="h-full bg-blood-500 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${(count / maxVotes) * 100}%` }}
              />
            </div>
            {count > 0 && (
              <p className="mt-1.5 text-xs text-night-100/60 truncate">
                {voterIds.map(nicknameOf).join(", ")}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
