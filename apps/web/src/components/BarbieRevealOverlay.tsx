"use client";

import { useEffect, useState } from "react";
import { ROLE_METADATA, type BarbieRevealResultPayload } from "@loupgarou/shared";
import { ROLE_EMOJI } from "./RoleCard";

/**
 * The one deliberately public, whole-room reveal in the game: Barbie points
 * at a player, discussion halts, and everyone watches the same card flip
 * over to show that player's real role, in sync. Purely presentational —
 * the actual death(s)/Chef change already happened server-side by the time
 * this payload arrives; this is just how the table SEES it happen.
 */
export function BarbieRevealOverlay({
  result,
  onDone,
}: {
  result: BarbieRevealResultPayload;
  onDone: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFlipped(true), 900);
    const t2 = setTimeout(() => setShowOutcome(true), 1900);
    const t3 = setTimeout(() => onDone(), 5500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const meta = ROLE_METADATA[result.targetRoleId];
  const isWolfOutcome = result.outcome === "WOLF_DIED_BARBIE_CHEF";

  return (
    <div
      className="fixed inset-0 z-50 bg-night-950/95 flex flex-col items-center justify-center gap-6 px-6 animate-fade-in cursor-pointer"
      onClick={showOutcome ? onDone : undefined}
    >
      <p className="text-xs uppercase tracking-widest text-gold-300/80">
        💃 {result.barbieNickname} démasque {result.targetNickname}
      </p>

      <div className="[perspective:1000px]">
        <div
          className={`relative w-48 h-64 sm:w-56 sm:h-72 transition-transform duration-700 [transform-style:preserve-3d] ${
            flipped ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          {/* Front: the player's name, face down */}
          <div className="absolute inset-0 rounded-2xl border-2 border-gold-400/50 bg-gradient-to-b from-night-800 to-night-950 shadow-xl flex items-center justify-center [backface-visibility:hidden]">
            <p className="font-display text-2xl text-gold-300 text-center px-3">{result.targetNickname}</p>
          </div>
          {/* Back: the revealed role */}
          <div
            className={`absolute inset-0 rounded-2xl border-2 shadow-xl flex flex-col items-center justify-center gap-2 [backface-visibility:hidden] [transform:rotateY(180deg)] ${
              isWolfOutcome
                ? "border-blood-400 bg-gradient-to-b from-blood-900/60 to-night-950"
                : "border-gold-400 bg-gradient-to-b from-night-800 to-night-950"
            }`}
          >
            <span className="text-5xl">{ROLE_EMOJI[result.targetRoleId]}</span>
            <p className="font-display text-xl text-gold-300 text-center px-3">{meta.displayName}</p>
          </div>
        </div>
      </div>

      {showOutcome && (
        <div className="text-center space-y-2 animate-fade-in max-w-md">
          {isWolfOutcome ? (
            <>
              <p className="text-lg text-blood-300">
                <strong>{result.targetNickname}</strong> était un loup — il/elle meurt sur-le-champ.
              </p>
              <p className="text-lg text-gold-300">
                👑 <strong>{result.barbieNickname}</strong> devient Chef du village.
              </p>
            </>
          ) : (
            <p className="text-lg text-blood-300">
              Ce n&apos;était pas un loup — <strong>{result.barbieNickname}</strong> et{" "}
              <strong>{result.targetNickname}</strong> meurent tous les deux.
            </p>
          )}
          <p className="text-xs text-night-100/50 pt-2">Touchez l&apos;écran pour continuer…</p>
        </div>
      )}
    </div>
  );
}
