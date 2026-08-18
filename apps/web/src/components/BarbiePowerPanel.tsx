"use client";

import { useState } from "react";
import type { PlayerPublic } from "@loupgarou/shared";
import { PlayerList } from "./PlayerList";

/**
 * Barbie's one-shot, once-per-game power — usable any time during Day
 * Discussion (day 1 or later). Deliberately NOT gated to "my turn": she can
 * interrupt whoever's currently speaking. Confirmation is required since
 * this can't be undone and always costs at least one life.
 */
export function BarbiePowerPanel({
  players,
  myId,
  onUse,
  isConnected = true,
}: {
  players: PlayerPublic[];
  myId: string;
  onUse: (targetId: string) => Promise<void>;
  /** 18 août 2026 — see NightPromptPanel's identical prop for why. */
  isConnected?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  // 17/08/2026: "Confirmer" used to call onUse fire-and-forget with zero
  // feedback — for a one-shot, irreversible power this is the worst place
  // for a silent failure. Same submit/error pattern used everywhere else.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligible = players.filter((p) => p.id !== myId && p.isAlive);

  async function confirmUse(targetId: string) {
    setError(null);
    setSubmitting(true);
    try {
      await onUse(targetId);
      // No local "sent" state to flip here — success is reflected by the
      // BARBIE_REVEAL_RESULT overlay (see play/[code]/page.tsx's
      // barbieReveal state) taking over the whole screen once it arrives.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'envoi. Réessayez.");
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="text-center">
        <button className="btn-primary" onClick={() => setOpen(true)}>
          💃 Interrompre pour démasquer quelqu&apos;un
        </button>
        <p className="text-xs text-night-100/50 mt-1">Pouvoir à usage unique — réfléchissez bien.</p>
      </div>
    );
  }

  if (pending) {
    const target = eligible.find((p) => p.id === pending);
    return (
      <div className="card border-2 border-blood-500/50 space-y-3 text-center">
        <p className="text-sm">
          Démasquer <strong className="text-gold-300">{target?.nickname}</strong> devant tout le monde,
          maintenant ?
        </p>
        <p className="text-xs text-night-100/60">
          Si c&apos;est un loup : il/elle meurt et vous devenez Chef du village. Sinon : vous mourrez
          tous/toutes les deux. Cette action est irréversible.
        </p>
        {!isConnected && (
          <p className="text-sm text-gold-300 bg-gold-500/10 border border-gold-500/30 rounded-lg px-3 py-2">
            🔌 Connexion perdue — reconnexion en cours…
          </p>
        )}
        {error && <p className="text-xs text-blood-400">{error}</p>}
        <div className="flex justify-center gap-2">
          <button
            className="btn-primary disabled:opacity-40"
            disabled={submitting || !isConnected}
            onClick={() => confirmUse(pending)}
          >
            Confirmer
          </button>
          <button
            className="btn-secondary disabled:opacity-40"
            disabled={submitting}
            onClick={() => setPending(null)}
          >
            Annuler
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-2 border-blood-500/50 space-y-3">
      <p className="text-sm text-night-100/80">Choisissez qui démasquer.</p>
      <PlayerList players={eligible} selectable onSelect={setPending} />
      <button className="btn-secondary w-full text-xs" onClick={() => setOpen(false)}>
        Annuler
      </button>
    </div>
  );
}
