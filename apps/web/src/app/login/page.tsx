"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount, ApiError } from "@/lib/auth";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get("returnTo") || "/";
  const { login, signup } = useAccount();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        await login(username.trim(), password);
      } else {
        await signup(username.trim(), password, email.trim());
      }
      router.push(returnTo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Erreur inconnue.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">🐺</div>
          <h1 className="font-display text-2xl text-gold-300">
            {mode === "login" ? "Bon retour, chasseur" : "Rejoignez le village"}
          </h1>
          <p className="text-sm text-night-100/60 mt-1">
            {mode === "login"
              ? "Connectez-vous pour retrouver votre profil, vos stats et votre historique."
              : "Créez votre compte permanent — vos stats et badges lui restent attachés pour toujours."}
          </p>
        </div>

        {/* Login / signup toggle — a sliding pill rather than two separate buttons, so switching mode feels like one continuous motion instead of a jarring page swap. */}
        <div className="relative grid grid-cols-2 rounded-lg border border-night-600 bg-night-900/60 p-1 mb-6">
          <div
            className="absolute inset-y-1 w-[calc(50%-4px)] rounded-md bg-blood-500 transition-transform duration-300 ease-out"
            style={{ transform: mode === "login" ? "translateX(0)" : "translateX(calc(100% + 8px))" }}
          />
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`relative z-10 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === "login" ? "text-white" : "text-night-100/60 hover:text-night-100"
            }`}
          >
            Se connecter
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`relative z-10 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === "signup" ? "text-white" : "text-night-100/60 hover:text-night-100"
            }`}
          >
            Créer un compte
          </button>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="text-sm text-night-100/70">Nom d&apos;utilisateur</label>
            <input
              className="input mt-1"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              title="Lettres, chiffres et _ uniquement"
              placeholder="Ex: Thomas"
              autoComplete="username"
              required
            />
          </div>

          {mode === "signup" && (
            <div className="animate-fade-in">
              <label className="text-sm text-night-100/70">
                Email <span className="text-night-100/40">(optionnel, recommandé)</span>
              </label>
              <input
                type="email"
                className="input mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                autoComplete="email"
              />
            </div>
          )}

          <div>
            <label className="text-sm text-night-100/70">Mot de passe</label>
            <input
              type="password"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="Au moins 8 caractères"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </div>

          {error && <p className="text-blood-300 text-sm">{error}</p>}

          <button className="btn-primary w-full" disabled={loading} type="submit">
            {loading ? "Un instant…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
