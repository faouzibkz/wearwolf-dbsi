"use client";

import Link from "next/link";
import { useAccount } from "@/lib/auth";

export default function HomePage() {
  const { account, logout } = useAccount();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-8">
      {/* Account-aware corner nav — deliberately quiet (small, top-right, low
          contrast until hovered) so it never competes with the big "join a
          game" CTA below, which is still what most visits are here for. */}
      <div className="absolute top-4 right-4 flex items-center gap-3 text-sm animate-fade-in">
        {/* Public, no account needed — see leaderboard/page.tsx's doc comment. */}
        <Link href="/leaderboard" className="text-night-100/70 hover:text-gold-300 transition-colors">
          Classements
        </Link>
        {account === undefined ? null : account ? (
          <>
            <Link href="/profile" className="text-night-100/70 hover:text-gold-300 transition-colors">
              👤 {account.displayName}
            </Link>
            <Link href="/history" className="text-night-100/70 hover:text-gold-300 transition-colors">
              Historique
            </Link>
            <Link href="/achievements" className="text-night-100/70 hover:text-gold-300 transition-colors">
              Succès
            </Link>
            <button onClick={() => void logout()} className="text-night-100/50 hover:text-blood-300 transition-colors">
              Déconnexion
            </button>
          </>
        ) : (
          <Link href="/login" className="btn-secondary text-xs px-3 py-1.5">
            Se connecter
          </Link>
        )}
      </div>

      <div className="animate-fade-in">
        <div className="text-6xl mb-4">🐺🌕</div>
        <h1 className="font-display text-4xl sm:text-5xl text-gold-300 mb-2">Loup-Garou</h1>
        <p className="text-night-100/70 max-w-md mx-auto">
          L&apos;application compagnon qui gère les rôles, les votes et les nuits — pendant que vous
          menez la partie.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-4">
        <Link href="/join" className="btn-primary text-lg px-8 py-3">
          Rejoindre une partie
        </Link>
        <Link href="/admin" className="btn-secondary text-lg px-8 py-3">
          Espace Maître du Jeu
        </Link>
      </div>
    </main>
  );
}
