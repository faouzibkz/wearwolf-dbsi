"use client";

import { useState } from "react";
import { ROLE_IDS, ROLE_METADATA, type RoleId } from "@loupgarou/shared";
import { ROLE_EMOJI } from "@/components/RoleCard";

/**
 * A small floating button, mirroring NotesButton.tsx's expand/collapse
 * pattern (bottom-LEFT instead of bottom-right so the two never overlap),
 * that lets any player check the full role roster for this game — which
 * roles are in play and how many of each — at any point, not just the one
 * moment the admin announces it out loud when the game starts. Directly
 * answers real player feedback: "the admin launched the game and I wasn't
 * listening when they said which roles were in this one."
 *
 * Composition only, never individual assignment: this never reveals WHO
 * has which role, only WHAT'S in the pool overall — exactly the
 * information an in-person moderator normally says out loud before play
 * begins, just written down and always reachable instead of said once.
 */
export function RoleCompositionButton({ composition }: { composition: Partial<Record<RoleId, number>> }) {
  const [open, setOpen] = useState(false);

  // Fixed canonical order (ROLE_IDS) rather than object key order — stable
  // and predictable across renders/roles, VILLAGEOIS first as the baseline
  // "everyone else" role, everything else in its usual definition order.
  const rows = ROLE_IDS.map((roleId) => ({ roleId, count: composition[roleId] ?? 0 })).filter(
    (r) => r.count > 0,
  );
  const totalPlayers = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start gap-2">
      <div
        className={`origin-bottom-left transition-all duration-300 ease-out ${
          open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-90 translate-y-2 pointer-events-none"
        }`}
      >
        <div className="card w-72 sm:w-80 space-y-2 shadow-2xl border-gold-500/30">
          <h3 className="font-display text-gold-300 text-sm">🎭 Rôles de cette partie</h3>
          <ul className="space-y-1">
            {rows.map(({ roleId, count }) => (
              <li key={roleId} className="flex items-center justify-between text-sm text-night-100/80">
                <span>
                  {ROLE_EMOJI[roleId]} {ROLE_METADATA[roleId].displayName}
                </span>
                <span className="text-gold-300 font-display">×{count}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-night-100/40 pt-2 border-t border-night-700/60">
            {totalPlayers} joueur{totalPlayers > 1 ? "s" : ""} au total — composition annoncée par le Maître
            du Jeu au lancement de la partie.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Fermer la liste des rôles" : "Voir les rôles de cette partie"}
        className="btn-secondary rounded-full w-12 h-12 flex items-center justify-center text-xl shadow-lg transition-transform duration-300 hover:scale-105 active:scale-95"
      >
        {open ? "✕" : "🎭"}
      </button>
    </div>
  );
}
