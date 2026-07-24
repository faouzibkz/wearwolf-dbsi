import http from "node:http";
import express from "express";
import cors from "cors";
import { Server } from "socket.io";
import { config } from "./config.js";
import { registerSocketHandlers } from "./socket/handlers.js";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: config.corsOrigin, methods: ["GET", "POST"] },
});

registerSocketHandlers(io);

httpServer.listen(config.port, () => {
  console.log(`[loup-garou] server listening on http://localhost:${config.port}`);
});
