"use client";

import { useState } from "react";
import { ROLE_METADATA, type NightPromptPayload, type PlayerPublic, type RoleId } from "@loupgarou/shared";
import { PlayerList } from "./PlayerList";
import { CountdownTimer } from "./CountdownTimer";

const ACTION_LABELS: Record<string, string> = {
  PROTECT: "Choisissez un joueur à protéger cette nuit.",
  INSPECT: "Choisissez un joueur à sonder.",
  KILL_VOTE: "Votez avec les autres loups pour désigner une victime.",
  SORCIERE_ACT: "Les loups ont choisi une victime. Que faites-vous ?",
  MARK: "Désignez un joueur qui recevra +2 votes demain.",
  CHOOSE_FATHER: "Choisissez en secret le joueur qui sera votre « père ».",
  ALIEN_GUESS: "Devinez le rôle exact d'un joueur (facultatif).",
  ALIEN_GUESS_MANDATORY: "Vous avez précipité la nuit : vous devez deviner le rôle d'un joueur cette nuit.",
};

export function NightPromptPanel({
  prompt,
  players,
  onSubmit,
}: {
  prompt: NightPromptPayload;
  players: PlayerPublic[];
  onSubmit: (actionType: string, targetId?: string, guessedRoleId?: RoleId) => void;
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

  if (prompt.actionType === "ALIEN_GUESS") {
    const ctx = prompt.context as {
      guessableRoleIds: RoleId[];
      villageChancesLeft: number;
      wolfChancesLeft: number;
      mustGuess: boolean;
    };
    const target = eligible.find((p) => p.id === selected);
    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-night-100/80">
          {ctx.mustGuess ? ACTION_LABELS.ALIEN_GUESS_MANDATORY : ACTION_LABELS.ALIEN_GUESS}
        </p>
        <p className="text-xs text-night-100/50">
          Chances restantes — village : <strong className="text-gold-300">{ctx.villageChancesLeft}</strong>{" "}
          · loups : <strong className="text-blood-300">{ctx.wolfChancesLeft}</strong>. Une mauvaise
          pioche dans une catégorie déjà à 0 vous est fatale.
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
              {ctx.guessableRoleIds.map((roleId) => (
                <button
                  key={roleId}
                  className="btn-secondary text-sm"
                  onClick={() => {
                    onSubmit("ALIEN_GUESS", target.id, roleId);
                    setSentChoice({ label: `${target.nickname} → ${ROLE_METADATA[roleId].displayName}` });
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
        {!ctx.mustGuess && (
          <button
            className="btn-secondary w-full text-sm"
            onClick={() => {
              onSubmit("SKIP");
              setSentChoice({ label: "Aucune tentative cette nuit" });
            }}
          >
            Ne rien tenter cette nuit
          </button>
        )}
        <CountdownTimer endsAt={prompt.deadlineAt} />
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

/** Generic "click to reveal a target list" button, used for optional/secondary actions (e.g. the Sorcière's poison potion). */
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
