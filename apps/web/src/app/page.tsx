import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-8">
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
