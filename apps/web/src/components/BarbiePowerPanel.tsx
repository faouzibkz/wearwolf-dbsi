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
}: {
  players: PlayerPublic[];
  myId: string;
  onUse: (targetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const eligible = players.filter((p) => p.id !== myId && p.isAlive);

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
        <div className="flex justify-center gap-2">
          <button className="btn-primary" onClick={() => onUse(pending)}>
            Confirmer
          </button>
          <button className="btn-secondary" onClick={() => setPending(null)}>
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
