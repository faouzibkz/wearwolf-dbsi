"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket";

/**
 * Partagé par tout composant qui a son propre état "submitting"/"armed"
 * basé sur un emitWithAck (NightPromptPanel, WolfChat, LiveVoteList, etc.).
 * Sans ça, un ack perdu pendant une coupure mobile (écran verrouillé,
 * changement d'appli) laisse le composant bloqué en "submitting=true"
 * pour toujours, même une fois la connexion revenue — c'est la cause
 * du bouton "Confirmer"/"Envoyer"/"Voter" qui reste mort sur mobile.
 *
 * Appelle `reset()` à chaque reconnexion du socket, pour que l'UI
 * redevienne immédiatement utilisable dès le retour de connexion.
 */
export function useResetOnReconnect(reset: () => void) {
  useEffect(() => {
    const socket = getSocket();
    function handleReconnect() {
      reset();
    }
    socket.on("connect", handleReconnect);
    return () => {
      socket.off("connect", handleReconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}