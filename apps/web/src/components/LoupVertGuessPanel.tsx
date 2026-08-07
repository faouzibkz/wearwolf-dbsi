"use client";

import { useState } from "react";
import { ROLE_METADATA, type LoupVertGuessPromptPayload, type PlayerPublic, type RoleId } from "@loupgarou/shared";
import { PlayerList } from "./PlayerList";
import { CountdownTimer } from "./CountdownTimer";

/**
 * The Loup Vert's own guess prompt — a dedicated side channel, independent
 * of the pack's own KILL_VOTE (which still comes through the standard
 * NightPromptPanel). Only ever shown to the Loup Vert himself; nobody else
 * ever sees this component or learns whether he acted.
 */
export function LoupVertGuessPanel({
  prompt,
  players,
  onSubmit,
}: {
  prompt: LoupVertGuessPromptPayload;
  players: PlayerPublic[];
  onSubmit: (targetId: string, guessedRoleId: RoleId) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const eligible = players.filter((p) => prompt.eligibleTargetIds.includes(p.id));
  const target = eligible.find((p) => p.id === selected);

  if (sent) {
    return (
      <div className="text-center py-6 text-night-100/70 animate-fade-in">
        <p className="text-sm">🐺 Votre supposition a été envoyée — vous seul(e) le saurez.</p>
      </div>
    );
  }

  return (
    <section className="card space-y-3 border-2 border-blood-500/40">
      <h3 className="font-display text-blood-300">🐺 Pouvoir du Loup vert</h3>
      <p className="text-xs text-night-100/60">
        Devinez le rôle exact d&apos;un villageois. Une bonne pioche vole son pouvoir — sans risque en cas
        d&apos;erreur.
      </p>
      {!target ? (
        <>
          <p className="text-xs text-night-100/60">1. Choisissez une cible.</p>
          <PlayerList players={eligible} selectable selectedId={selected} onSelect={setSelected} />
        </>
      ) : (
        <>
          <p className="text-xs text-night-100/60">
            2. Quel rôle pensez-vous que <strong className="text-gold-300">{target.nickname}</strong> a ?
          </p>
          <div className="grid grid-cols-2 gap-2">
            {prompt.guessableRoleIds.map((roleId) => (
              <button
                key={roleId}
                className="btn-secondary text-sm"
                onClick={() => {
                  onSubmit(target.id, roleId);
                  setSent(true);
                }}
              >
                {ROLE_METADATA[roleId].displayName}
              </button>
            ))}
          </div>
          <button className="btn-secondary text-xs" onClick={() => setSelected(null)}>
            ← Changer de cible
          </button>
        </>
      )}
      <CountdownTimer endsAt={prompt.deadlineAt} />
    </section>
  );
}
