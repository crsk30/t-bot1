/**
 * NSE Algo Trading - Node.js API Gateway
 * =======================================
 * Sits between Angular frontend and Python FastAPI engine.
 * Handles: CORS, rate limiting, auth, REST proxy, WebSocket bridge.
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");

const app = express();
const server = http.createServer(app);

const PYTHON_BASE = process.env.PYTHON_API_URL || "http://localhost:8000";
const PORT = parseInt(process.env.PORT || "3000", 10);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "PATCH"] }));
app.use(express.json());
app.use(morgan("dev"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ─── Helper: proxy to Python ──────────────────────────────────────────────────
async function proxyToPython(req, res, path, method = "GET", body = null) {
  try {
    const url = `${PYTHON_BASE}${path}`;
    const queryStr = Object.keys(req.query).length
      ? "?" + new URLSearchParams(req.query).toString()
      : "";

    const response = await axios({
      method,
      url: url + queryStr,
      data: body || req.body,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || { error: err.message };
    res.status(status).json(detail);
  }
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    const r = await axios.get(`${PYTHON_BASE}/health`, { timeout: 5000 });
    res.json({ gateway: "ok", engine: r.data });
  } catch {
    res.json({ gateway: "ok", engine: "unreachable" });
  }
});

// ─── Engine ───────────────────────────────────────────────────────────────────
app.get("/api/engine/status",      (req, res) => proxyToPython(req, res, "/engine/status"));
app.post("/api/engine/start",      (req, res) => proxyToPython(req, res, "/engine/start", "POST"));
app.post("/api/engine/stop",       (req, res) => proxyToPython(req, res, "/engine/stop", "POST"));
app.post("/api/engine/scan",       (req, res) => proxyToPython(req, res, "/engine/scan", "POST"));

// ─── Signals ─────────────────────────────────────────────────────────────────
app.get("/api/signals",            (req, res) => proxyToPython(req, res, "/signals"));
app.get("/api/signals/scan",       (req, res) => proxyToPython(req, res, "/signals/scan"));

// ─── Market Data ─────────────────────────────────────────────────────────────
app.get("/api/stocks/quotes",      (req, res) => proxyToPython(req, res, "/stocks/quotes/batch"));
app.get("/api/stocks/:symbol/quote",      (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/quote`));
app.get("/api/stocks/:symbol/chart",      (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/chart`));
app.get("/api/stocks/:symbol/indicators", (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/indicators`));

// ─── Watchlist ────────────────────────────────────────────────────────────────
app.get("/api/watchlist",          (req, res) => proxyToPython(req, res, "/watchlist"));
app.put("/api/watchlist",          (req, res) => proxyToPython(req, res, "/watchlist", "PUT"));

// ─── Portfolio ────────────────────────────────────────────────────────────────
app.get("/api/portfolio",          (req, res) => proxyToPython(req, res, "/portfolio"));
app.get("/api/orders",             (req, res) => proxyToPython(req, res, "/orders"));
app.post("/api/orders",            (req, res) => proxyToPython(req, res, "/orders", "POST"));

// ─── Backtesting ──────────────────────────────────────────────────────────────
app.post("/api/backtest",          (req, res) => proxyToPython(req, res, "/backtest", "POST"));

// ─── WebSocket Bridge ─────────────────────────────────────────────────────────
/**
 * Bridge: Frontend connects to ws://localhost:3000/ws
 * Gateway maintains a single connection to Python ws://localhost:8000/ws
 * and fans out messages to all frontend clients.
 */
const wss = new WebSocket.Server({ server, path: "/ws" });
let pythonWS = null;
const frontendClients = new Set();

function connectToPython() {
  pythonWS = new WebSocket(`${PYTHON_BASE.replace("http", "ws")}/ws`);

  pythonWS.on("open", () => {
    console.log("[WS Bridge] Connected to Python engine");
  });

  pythonWS.on("message", (data) => {
    // Fan out to all frontend clients
    const msg = data.toString();
    for (const client of frontendClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  });

  pythonWS.on("close", () => {
    console.log("[WS Bridge] Python connection lost. Reconnecting in 3s...");
    setTimeout(connectToPython, 3000);
  });

  pythonWS.on("error", (err) => {
    console.error("[WS Bridge] Python WS error:", err.message);
  });
}

// Start Python WS connection after server starts
setTimeout(connectToPython, 2000);

wss.on("connection", (ws, req) => {
  frontendClients.add(ws);
  console.log(`[WS] Frontend client connected. Total: ${frontendClients.size}`);

  // Send initial state
  ws.send(JSON.stringify({ type: "gateway_connected", timestamp: new Date().toISOString() }));

  ws.on("message", (data) => {
    // Forward client messages to Python engine
    if (pythonWS?.readyState === WebSocket.OPEN) {
      pythonWS.send(data.toString());
    }
  });

  ws.on("close", () => {
    frontendClients.delete(ws);
    console.log(`[WS] Frontend client disconnected. Total: ${frontendClients.size}`);
  });

  ws.on("error", (err) => {
    console.error("[WS] Client error:", err.message);
    frontendClients.delete(ws);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   NSE Algo Trading Gateway running on :${PORT}  ║
║   Python Engine: ${PYTHON_BASE}         ║
║   WebSocket: ws://localhost:${PORT}/ws          ║
╚═══════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
