"use client";

import type { RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";

const ROLE_EMOJI: Record<RoleId, string> = {
  VILLAGEOIS: "🧑‍🌾",
  LOUP_GAROU: "🐺",
  LOUP_BLANC: "🐺",
  SORCIERE: "🧙‍♀️",
  VOYANTE: "🔮",
  SALVATEUR: "🛡️",
  CHASSEUR: "🏹",
  CORBEAU: "🐦‍⬛",
  MOWGLI: "🌿",
};

export function RoleCard({ roleId, compact = false }: { roleId: RoleId; compact?: boolean }) {
  const meta = ROLE_METADATA[roleId];
  return (
    <div
      className={`rounded-2xl border border-gold-400/40 bg-gradient-to-b from-night-800 to-night-950 shadow-lg shadow-black/50 animate-fade-in ${
        compact ? "p-4" : "p-6"
      }`}
    >
      <div className="text-5xl mb-3 text-center">{ROLE_EMOJI[roleId]}</div>
      <h2 className="font-display text-xl text-gold-300 text-center mb-1">{meta.displayName}</h2>
      <p className="text-xs uppercase tracking-wide text-center text-night-600 mb-3">
        {meta.team === "LOUPS" ? "Camp des Loups-garous" : "Camp du Village"}
      </p>
      {!compact && <p className="text-sm text-night-100/80 leading-relaxed">{meta.shortDescription}</p>}
    </div>
  );
}
