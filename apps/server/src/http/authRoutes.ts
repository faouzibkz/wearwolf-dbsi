import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import { signSessionToken } from "../auth/jwt.js";
import { clearSessionCookie, readSessionFromRequest, setSessionCookie } from "../auth/cookies.js";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function publicUser(user: { id: string; username: string; displayName: string; createdAt: Date }) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export const authRouter = Router();

/**
 * Account creation (spec section 1). No OAuth yet (explicitly called out in
 * the spec as a future version) — username + optional email + password.
 * `displayName` defaults to `username` at signup; nothing in this route
 * ever touches a game's per-game nickname (that's PLAYER_JOIN's `nickname`
 * field, entirely separate — see spec section 2).
 */
authRouter.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body ?? {};
    if (typeof username !== "string" || !USERNAME_RE.test(username)) {
      res.status(400).json({ error: "Le nom d'utilisateur doit faire 3 à 20 caractères (lettres, chiffres, _)." });
      return;
    }
    if (typeof password !== "string" || password.length < 8) {
      res.status(400).json({ error: "Le mot de passe doit faire au moins 8 caractères." });
      return;
    }
    if (email !== undefined && email !== null && email !== "" && typeof email !== "string") {
      res.status(400).json({ error: "Email invalide." });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(409).json({ error: "Ce nom d'utilisateur est déjà pris." });
      return;
    }
    if (email) {
      const existingEmail = await prisma.user.findUnique({ where: { email } });
      if (existingEmail) {
        res.status(409).json({ error: "Cet email est déjà utilisé." });
        return;
      }
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { username, email: email || null, passwordHash, displayName: username },
    });

    const token = signSessionToken({ userId: user.id, username: user.username });
    setSessionCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error("[auth] signup failed", err);
    res.status(500).json({ error: "Erreur serveur, réessayez." });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== "string" || typeof password !== "string") {
      res.status(400).json({ error: "Identifiants invalides." });
      return;
    }
    const user = await prisma.user.findUnique({ where: { username } });
    // Deliberately identical error for "no such user" and "wrong password"
    // — distinguishing them lets an attacker enumerate valid usernames.
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Nom d'utilisateur ou mot de passe incorrect." });
      return;
    }
    const token = signSessionToken({ userId: user.id, username: user.username });
    setSessionCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("[auth] login failed", err);
    res.status(500).json({ error: "Erreur serveur, réessayez." });
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get("/me", async (req, res) => {
  const session = readSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: "Non connecté." });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    // Account was deleted since the cookie was issued.
    clearSessionCookie(res);
    res.status(401).json({ error: "Non connecté." });
    return;
  }
  res.json({ user: publicUser(user) });
});
