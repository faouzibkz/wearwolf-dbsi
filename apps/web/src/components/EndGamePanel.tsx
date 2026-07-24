"use client";

import type { EndGameStats } from "@loupgarou/shared";
import { RoleCard } from "./RoleCard";

export function EndGamePanel({ stats }: { stats: unknown }) {
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
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
