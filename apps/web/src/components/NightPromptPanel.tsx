"use client";

import { useState } from "react";
import type { NightPromptPayload, PlayerPublic } from "@loupgarou/shared";
import { PlayerList } from "./PlayerList";
import { CountdownTimer } from "./CountdownTimer";

const ACTION_LABELS: Record<string, string> = {
  PROTECT: "Choisissez un joueur à protéger cette nuit.",
  INSPECT: "Choisissez un joueur à sonder.",
  KILL_VOTE: "Votez avec les autres loups pour désigner une victime.",
  DEVOUR_WOLF: "Vous pouvez dévorer un loup-garou cette nuit (optionnel).",
  SORCIERE_ACT: "Les loups ont choisi une victime. Que faites-vous ?",
  MARK: "Désignez un joueur qui recevra +2 votes demain.",
  CHOOSE_FATHER: "Choisissez en secret le joueur qui sera votre « père ».",
};

export function NightPromptPanel({
  prompt,
  players,
  onSubmit,
}: {
  prompt: NightPromptPayload;
  players: PlayerPublic[];
  onSubmit: (actionType: string, targetId?: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const eligible = players.filter((p) => prompt.eligibleTargetIds.includes(p.id));

  if (sent) {
    return (
      <div className="text-center py-8 text-night-100/70 animate-fade-in">
        <p className="font-display text-lg text-gold-300 mb-2">Action envoyée.</p>
        <p className="text-sm">En attente de la résolution de la nuit…</p>
      </div>
    );
  }

  if (prompt.actionType === "SORCIERE_ACT") {
    const ctx = prompt.context as { attackedPlayerId: string | null; canHeal: boolean; canPoison: boolean };
    const attacked = players.find((p) => p.id === ctx.attackedPlayerId);
    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-night-100/80">
          {attacked ? (
            <>
              Les loups-garous ont attaqué <strong className="text-blood-300">{attacked.nickname}</strong>.
            </>
          ) : (
            "Les loups n'ont attaqué personne d'identifiable cette nuit."
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {ctx.canHeal && (
            <button
              className="btn-primary"
              onClick={() => {
                onSubmit("HEAL");
                setSent(true);
              }}
            >
              🧪 Utiliser la potion de guérison
            </button>
          )}
          {ctx.canPoison && (
            <PoisonPicker
              players={eligible}
              onPick={(id) => {
                onSubmit("POISON", id);
                setSent(true);
              }}
            />
          )}
          <button
            className="btn-secondary"
            onClick={() => {
              onSubmit("SKIP");
              setSent(true);
            }}
          >
            Ne rien faire
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-sm text-night-100/80">{ACTION_LABELS[prompt.actionType] ?? "Choisissez une cible."}</p>
      <PlayerList players={eligible} selectable selectedId={selected} onSelect={setSelected} />
      <div className="flex gap-2">
        <button
          className="btn-primary disabled:opacity-40"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            onSubmit(prompt.actionType, selected);
            setSent(true);
          }}
        >
          Confirmer
        </button>
        {prompt.actionType === "DEVOUR_WOLF" && (
          <button
            className="btn-secondary"
            onClick={() => {
              onSubmit("SKIP");
              setSent(true);
            }}
          >
            Passer
          </button>
        )}
      </div>
      <CountdownTimer endsAt={prompt.deadlineAt} />
    </div>
  );
}

function PoisonPicker({ players, onPick }: { players: PlayerPublic[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        ☠️ Utiliser la potion de poison
      </button>
    );
  }
  return (
    <div className="w-full space-y-2">
      <PlayerList players={players} selectable onSelect={onPick} />
    </div>
  );
}
