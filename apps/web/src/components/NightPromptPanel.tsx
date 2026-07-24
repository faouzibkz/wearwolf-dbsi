"use client";

import { useState } from "react";
import type { NightPromptPayload, PlayerPublic } from "@loupgarou/shared";
import { PlayerList } from "./PlayerList";
import { CountdownTimer } from "./CountdownTimer";

const ACTION_LABELS: Record<string, string> = {
  PROTECT: "Choisissez un joueur à protéger cette nuit.",
  INSPECT: "Choisissez un joueur à sonder.",
  KILL_VOTE: "Votez avec les autres loups pour désigner une victime.",
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
  const [sentChoice, setSentChoice] = useState<{ label: string } | null>(null);
  const eligible = players.filter((p) => prompt.eligibleTargetIds.includes(p.id));

  if (sentChoice) {
    return (
      <div className="text-center py-8 text-night-100/70 animate-fade-in">
        <p className="font-display text-lg text-gold-300 mb-2">Action envoyée.</p>
        <p className="text-sm">
          Votre choix : <strong className="text-blood-300">{sentChoice.label}</strong>
        </p>
        <p className="text-sm mt-1">En attente de la résolution de la nuit…</p>
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
                setSentChoice({ label: `Potion de guérison sur ${attacked?.nickname ?? "la victime"}` });
              }}
            >
              🧪 Utiliser la potion de guérison
            </button>
          )}
          {ctx.canPoison && (
            <ExpandablePicker
              label="☠️ Utiliser la potion de poison"
              players={eligible}
              onPick={(id) => {
                onSubmit("POISON", id);
                const target = eligible.find((p) => p.id === id);
                setSentChoice({ label: `Potion de poison sur ${target?.nickname ?? "?"}` });
              }}
            />
          )}
          <button
            className="btn-secondary"
            onClick={() => {
              onSubmit("SKIP");
              setSentChoice({ label: "Aucune action" });
            }}
          >
            Ne rien faire
          </button>
        </div>
      </div>
    );
  }

  if (prompt.actionType === "LOUP_BLANC_ACT") {
    const ctx = prompt.context as { killEligible: string[]; devourEligible: string[] };
    const killTargets = players.filter((p) => ctx.killEligible.includes(p.id));
    const devourTargets = players.filter((p) => ctx.devourEligible.includes(p.id));
    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-night-100/80">
          Votez avec les autres loups pour désigner une victime cette nuit.
        </p>
        <PlayerList players={killTargets} selectable selectedId={selected} onSelect={setSelected} />
        <button
          className="btn-primary disabled:opacity-40"
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            onSubmit("KILL_VOTE", selected);
            const target = killTargets.find((p) => p.id === selected);
            setSentChoice({ label: target?.nickname ?? "?" });
          }}
        >
          Confirmer{selected ? ` : ${killTargets.find((p) => p.id === selected)?.nickname ?? ""}` : ""}
        </button>
        {devourTargets.length > 0 && (
          <div className="pt-3 border-t border-night-700 space-y-2">
            <p className="text-xs text-night-100/60">
              Vous pouvez aussi dévorer secrètement un loup-garou cette nuit, à la place :
            </p>
            <ExpandablePicker
              label="🐺 Dévorer un loup-garou"
              players={devourTargets}
              onPick={(id) => {
                onSubmit("DEVOUR_WOLF", id);
                const target = devourTargets.find((p) => p.id === id);
                setSentChoice({ label: `Dévoré : ${target?.nickname ?? "?"}` });
              }}
            />
          </div>
        )}
        <CountdownTimer endsAt={prompt.deadlineAt} />
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
            const target = eligible.find((p) => p.id === selected);
            setSentChoice({ label: target?.nickname ?? "?" });
          }}
        >
          Confirmer{selected ? ` : ${eligible.find((p) => p.id === selected)?.nickname ?? ""}` : ""}
        </button>
      </div>
      <CountdownTimer endsAt={prompt.deadlineAt} />
    </div>
  );
}

/** Generic "click to reveal a target list" button, used for optional/secondary actions (poison potion, Loup Blanc's devour). */
function ExpandablePicker({
  label,
  players,
  onPick,
}: {
  label: string;
  players: PlayerPublic[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="w-full space-y-2">
      <PlayerList players={players} selectable onSelect={onPick} />
    </div>
  );
}
