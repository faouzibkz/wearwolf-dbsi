"use client";

import type { PlayerPublic } from "@loupgarou/shared";

export function PlayerList({
  players,
  highlightId,
  selectable,
  selectedId,
  onSelect,
  disabledIds = [],
}: {
  players: PlayerPublic[];
  highlightId?: string | null;
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  disabledIds?: string[];
}) {
  return (
    <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {players.map((p) => {
        const disabled = disabledIds.includes(p.id) || !p.isAlive;
        const clickable = selectable && !disabled;
        return (
          <li
            key={p.id}
            onClick={() => clickable && onSelect?.(p.id)}
            className={[
              "rounded-lg border px-3 py-2 text-sm flex items-center justify-between gap-2 transition",
              p.isAlive ? "border-night-600 bg-night-800/70" : "border-night-700 bg-night-900/40 opacity-50 line-through",
              highlightId === p.id ? "ring-2 ring-gold-400" : "",
              selectedId === p.id ? "border-blood-400 bg-blood-500/20" : "",
              clickable ? "cursor-pointer hover:border-gold-400/60" : "",
            ].join(" ")}
          >
            <span className="truncate">{p.nickname}</span>
            <span className="flex items-center gap-1 shrink-0">
              {p.isChef && <span title="Chef du village">👑</span>}
              {!p.isConnected && p.isAlive && <span className="text-xs text-night-600" title="Déconnecté">⚡</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
