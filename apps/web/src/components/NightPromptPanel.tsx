"use client";

import { useEffect, useState } from "react";
import {
  ROLE_METADATA,
  type NightPromptPayload,
  type PlayerPublic,
  type RoleId,
  type WolfRoomStatePayload,
} from "@loupgarou/shared";
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
  PRETRE_SHOOT:
    "Vous pouvez tirer sur un joueur de votre choix, y compris vous-même — une seule fois dans toute la partie. " +
    "Si c'est un loup, il meurt et vous continuez de jouer. Sinon, c'est vous qui mourrez. Vous pouvez aussi garder votre pouvoir pour une nuit future.",
};

export function NightPromptPanel({
  prompt,
  players,
  onSubmit,
  wolfRoom,
  onPreview,
}: {
  prompt: NightPromptPayload;
  players: PlayerPublic[];
  onSubmit: (actionType: string, targetId?: string, guessedRoleId?: RoleId) => void;
  /**
   * KILL_VOTE only — live view of the whole pack's picks (see
   * WolfRoomStatePayload.currentVotes/previewVotes). Ignored for every
   * other actionType.
   */
  wolfRoom?: WolfRoomStatePayload | null;
  /**
   * KILL_VOTE only — fired on every local selection change, BEFORE
   * "Confirmer" (targetId: null on deselect), so teammates see this wolf's
   * live pick in real time via WolfRoomStatePayload.previewVotes, not just
   * once submitted. See play/[code]/page.tsx's WOLF_TARGET_PREVIEW emit.
   */
  onPreview?: (targetId: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sentChoice, setSentChoice] = useState<{ label: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const eligible = players.filter((p) => prompt.eligibleTargetIds.includes(p.id));

  // Best-effort: if this prompt disappears (submitted, or the night ended
  // out from under an undecided wolf) while a preview is still live,
  // clear it so teammates don't see a stale "still considering…" forever.
  useEffect(() => {
    return () => onPreview?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every action below funnels through here instead of calling onSubmit
  // directly. onSubmit is async (it round-trips an ack to the server) —
  // calling it fire-and-forget and flipping to the "Action envoyée"
  // confirmation screen immediately, regardless of whether the ack ever
  // came back ok, used to mean a rejected or dropped submission (a stale
  // connection, a network blip, the server throwing) looked EXACTLY like a
  // successful one: the player saw "envoyée" and moved on while the server
  // never actually recorded anything. For a one-shot power like the
  // Prêtre's this is silent and irreversible — the reported "his power
  // just doesn't work" bug. Now the confirmation screen only ever appears
  // once the ack has actually come back ok; a failure surfaces an error
  // and leaves the picker up so the player can retry.
  async function submitAndConfirm(
    actionType: string,
    targetId: string | undefined,
    guessedRoleId: RoleId | undefined,
    label: string,
  ) {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onSubmit(actionType, targetId, guessedRoleId);
      setSentChoice({ label });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Échec de l'envoi. Réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

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
                  className="btn-secondary text-sm disabled:opacity-40"
                  disabled={submitting}
                  onClick={() =>
                    submitAndConfirm(
                      "ALIEN_GUESS",
                      target.id,
                      roleId,
                      `${target.nickname} → ${ROLE_METADATA[roleId].displayName}`,
                    )
                  }
                >
                  {ROLE_METADATA[roleId].displayName}
                </button>
              ))}
            </div>
            <button className="btn-secondary text-xs" disabled={submitting} onClick={() => setSelected(null)}>
              ← Changer de cible
            </button>
          </>
        )}
        {submitError && <p className="text-xs text-blood-400">{submitError}</p>}
        {!ctx.mustGuess && (
          <button
            className="btn-secondary w-full text-sm disabled:opacity-40"
            disabled={submitting}
            onClick={() => submitAndConfirm("SKIP", undefined, undefined, "Aucune tentative cette nuit")}
          >
            Ne rien tenter cette nuit
          </button>
        )}
        <CountdownTimer endsAt={prompt.deadlineAt} />
      </div>
    );
  }

  if (prompt.actionType === "PRETRE_SHOOT") {
    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-night-100/80">{ACTION_LABELS.PRETRE_SHOOT}</p>
        <PlayerList players={eligible} selectable selectedId={selected} onSelect={setSelected} />
        {submitError && <p className="text-xs text-blood-400">{submitError}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary disabled:opacity-40"
            disabled={!selected || submitting}
            onClick={() => {
              if (!selected) return;
              const target = eligible.find((p) => p.id === selected);
              submitAndConfirm("PRETRE_SHOOT", selected, undefined, `Tir sur ${target?.nickname ?? "?"}`);
            }}
          >
            🔫 Tirer{selected ? ` sur ${eligible.find((p) => p.id === selected)?.nickname ?? ""}` : ""}
          </button>
          <button
            className="btn-secondary disabled:opacity-40"
            disabled={submitting}
            onClick={() => submitAndConfirm("SKIP", undefined, undefined, "Pouvoir gardé en réserve")}
          >
            Ne rien faire cette nuit
          </button>
        </div>
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
        {submitError && <p className="text-xs text-blood-400">{submitError}</p>}
        <div className="flex flex-wrap gap-2">
          {ctx.canHeal && (
            <button
              className="btn-primary disabled:opacity-40"
              disabled={submitting}
              onClick={() =>
                submitAndConfirm("HEAL", undefined, undefined, `Potion de guérison sur ${attacked?.nickname ?? "la victime"}`)
              }
            >
              🧪 Utiliser la potion de guérison
            </button>
          )}
          {ctx.canPoison && (
            <ExpandablePicker
              label="☠️ Utiliser la potion de poison"
              players={eligible}
              disabled={submitting}
              onPick={(id) => {
                const target = eligible.find((p) => p.id === id);
                submitAndConfirm("POISON", id, undefined, `Potion de poison sur ${target?.nickname ?? "?"}`);
              }}
            />
          )}
          <button
            className="btn-secondary disabled:opacity-40"
            disabled={submitting}
            onClick={() => submitAndConfirm("SKIP", undefined, undefined, "Aucune action")}
          >
            Ne rien faire
          </button>
        </div>
      </div>
    );
  }

  if (prompt.actionType === "KILL_VOTE") {
    const ctx = (prompt.context ?? {}) as { currentVotes?: Record<string, string> };
    // Confirmed votes come straight from the prompt's own context
    // (GameEngine.getWolfKillVotes, refreshed on every re-prompt); live
    // pre-confirm previews come from the separate WOLF_ROOM_STATE channel.
    // Confirmed always wins if somehow both are present for the same wolf.
    const confirmed = ctx.currentVotes ?? {};
    const previewing = wolfRoom?.previewVotes ?? {};
    const packPicks = (wolfRoom?.members ?? [])
      .map((m) => {
        const targetId = confirmed[m.id] ?? previewing[m.id];
        if (!targetId) return null;
        const target = players.find((p) => p.id === targetId);
        return {
          voterId: m.id,
          voterNickname: m.nickname,
          targetNickname: target?.nickname ?? "?",
          isConfirmed: Boolean(confirmed[m.id]),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    function selectAndPreview(id: string | null) {
      setSelected(id);
      onPreview?.(id);
    }

    return (
      <div className="space-y-4 animate-fade-in">
        <p className="text-sm text-night-100/80">{ACTION_LABELS.KILL_VOTE}</p>

        {/* Live pack view — big, real-time, updates the instant ANY wolf
            (including this one) picks or changes a target, confirmed or
            not. This is Feature 6: teammates see it while you're still
            deciding, not just after you hit "Confirmer". */}
        {packPicks.length > 0 && (
          <div className="rounded-lg border border-blood-500/30 bg-blood-500/5 p-3 space-y-2">
            <p className="text-xs text-blood-300/80 uppercase tracking-wide">🐺 La meute en direct</p>
            <ul className="space-y-1.5">
              {packPicks.map((p) => (
                <li key={p.voterId} className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-night-100/70">{p.voterNickname}</span>
                  <span
                    className={`font-display text-lg transition-colors ${
                      p.isConfirmed ? "text-blood-300" : "text-gold-300/80 animate-pulse-slow"
                    }`}
                  >
                    → {p.targetNickname}
                    {!p.isConfirmed && <span className="text-xs align-top"> …</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PlayerList players={eligible} selectable selectedId={selected} onSelect={selectAndPreview} />
        {selected && (
          <button className="text-xs text-night-100/50 hover:text-night-100/80" onClick={() => selectAndPreview(null)}>
            ✕ Annuler ma sélection
          </button>
        )}
        {submitError && <p className="text-xs text-blood-400">{submitError}</p>}
        <div className="flex gap-2">
          <button
            className="btn-primary disabled:opacity-40"
            disabled={!selected || submitting}
            onClick={() => {
              if (!selected) return;
              const target = eligible.find((p) => p.id === selected);
              submitAndConfirm("KILL_VOTE", selected, undefined, target?.nickname ?? "?");
            }}
          >
            Confirmer{selected ? ` : ${eligible.find((p) => p.id === selected)?.nickname ?? ""}` : ""}
          </button>
        </div>
        <CountdownTimer endsAt={prompt.deadlineAt} />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <p className="text-sm text-night-100/80">{ACTION_LABELS[prompt.actionType] ?? "Choisissez une cible."}</p>
      <PlayerList players={eligible} selectable selectedId={selected} onSelect={setSelected} />
      {submitError && <p className="text-xs text-blood-400">{submitError}</p>}
      <div className="flex gap-2">
        <button
          className="btn-primary disabled:opacity-40"
          disabled={!selected || submitting}
          onClick={() => {
            if (!selected) return;
            const target = eligible.find((p) => p.id === selected);
            submitAndConfirm(prompt.actionType, selected, undefined, target?.nickname ?? "?");
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
  disabled,
}: {
  label: string;
  players: PlayerPublic[];
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="btn-secondary disabled:opacity-40" disabled={disabled} onClick={() => setOpen(true)}>
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
