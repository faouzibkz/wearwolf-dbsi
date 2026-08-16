"use client";

import type { RoleId } from "@loupgarou/shared";
import { ROLE_METADATA } from "@loupgarou/shared";

export const ROLE_EMOJI: Record<RoleId, string> = {
  VILLAGEOIS: "🧑‍🌾",
  LOUP_GAROU: "🐺",
  LOUP_BLANC: "🐺",
  LOUP_VERT: "🐺",
  SORCIERE: "🧙‍♀️",
  VOYANTE: "🔮",
  SALVATEUR: "🛡️",
  CHASSEUR: "🏹",
  CORBEAU: "🐦‍⬛",
  MOWGLI: "🌿",
  BARBIE: "💃",
  ALIEN: "👽",
  PRETRE: "✝️",
};

export function RoleCard({
  roleId,
  compact = false,
  teammates = [],
}: {
  roleId: RoleId;
  compact?: boolean;
  /** Fellow wolves, if roleId is a wolf-team role — see RoleAssignedPayload. */
  teammates?: { id: string; nickname: string }[];
}) {
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
        {meta.team === "LOUPS"
          ? "Camp des Loups-garous"
          : meta.team === "SOLO"
            ? "Solitaire — contre tous"
            : "Camp du Village"}
      </p>
      {!compact && <p className="text-sm text-night-100/80 leading-relaxed">{meta.shortDescription}</p>}
      {teammates.length > 0 && (
        <p className="text-sm text-blood-300 text-center mt-3 pt-3 border-t border-night-700/60">
          Vous êtes loup avec :{" "}
          <strong>{teammates.map((t) => t.nickname).join(", ")}</strong>
        </p>
      )}
    </div>
  );
}
