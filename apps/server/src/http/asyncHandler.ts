import type { NextFunction, Request, Response } from "express";

/**
 * Wraps an async Express handler so a rejected promise (e.g. an unexpected
 * Prisma error) is forwarded to `next(err)` instead of becoming an
 * unhandled rejection.
 *
 * Why this exists: on 2026-08-08, GET /me crashed the ENTIRE server process
 * (not just that one request) the moment Prisma threw on a schema/DB
 * mismatch (P2022, a missing migration) — Express does not catch rejected
 * promises from async handlers on its own, so the error had nowhere to go
 * and Node treated it as an unhandled rejection, killing the process and
 * disconnecting every game in progress, not just the one player who hit
 * /me. See index.ts's global error-handling middleware for what happens to
 * the error once it reaches `next()`: it's logged and turned into a plain
 * 500, exactly like every route below that already had its own try/catch.
 *
 * Every async route handler in this app should be wrapped in this (or have
 * its own try/catch, like authRoutes.ts's /signup and /login) — there is no
 * reason for a single player's bad request, or a single DB hiccup, to ever
 * take the whole table down.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Req, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
