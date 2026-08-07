import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config } from "./config.js";
import { registerSocketHandlers } from "./socket/handlers.js";
import { authRouter } from "./http/authRoutes.js";
import { accountApiRouter } from "./http/accountRoutes.js";

const app = express();
// credentials: true is required for the session cookie to ride along on
// cross-origin requests from the web app (different port in dev, possibly
// a different subdomain in prod) — see auth/cookies.ts.
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

app.use("/api/auth", authRouter);
app.use("/api", accountApiRouter);

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.corsOrigin, methods: ["GET", "POST"], credentials: true },
});

registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`[loup-garou] server listening on http://localhost:${config.port}`);
});
