/**
 * NSE Algo Trading - Node.js API Gateway
 * =======================================
 * Sits between Ionic frontend and Python FastAPI engine.
 * Handles: CORS, rate limiting, auth, REST proxy, WebSocket bridge, Ollama AI.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");
const ollamaService = require("./ollama.service");
const emailScheduler = require("./email-scheduler");

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

    const axiosConfig = {
      method,
      url: url + queryStr,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    };
    if (method !== "GET" && method !== "HEAD") {
      axiosConfig.data = body || req.body;
    }

    const response = await axios(axiosConfig);
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
    const [engineRes, ollamaStatus] = await Promise.allSettled([
      axios.get(`${PYTHON_BASE}/health`, { timeout: 5000 }),
      ollamaService.getOllamaStatus(),
    ]);
    res.json({
      gateway: "ok",
      engine: engineRes.status === "fulfilled" ? engineRes.value.data : "unreachable",
      ollama: ollamaStatus.status === "fulfilled" ? ollamaStatus.value : { online: false },
    });
  } catch {
    res.json({ gateway: "ok", engine: "unreachable", ollama: { online: false } });
  }
});

// ─── Engine ───────────────────────────────────────────────────────────────────
app.get("/api/engine/status", (req, res) => proxyToPython(req, res, "/engine/status"));
app.post("/api/engine/start", (req, res) => proxyToPython(req, res, "/engine/start", "POST"));
app.post("/api/engine/stop", (req, res) => proxyToPython(req, res, "/engine/stop", "POST"));
app.post("/api/engine/scan", (req, res) => proxyToPython(req, res, "/engine/scan", "POST"));

// ─── Signals ─────────────────────────────────────────────────────────────────
app.get("/api/signals", (req, res) => proxyToPython(req, res, "/signals"));
app.get("/api/signals/scan", (req, res) => proxyToPython(req, res, "/signals/scan"));

// ─── Market Data ─────────────────────────────────────────────────────────────
app.get("/api/market/trend", (req, res) => proxyToPython(req, res, "/market/trend"));
app.get("/api/stocks/quotes", (req, res) => proxyToPython(req, res, "/stocks/quotes/batch"));
app.get("/api/stocks/:symbol/quote", (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/quote`));
app.get("/api/stocks/:symbol/chart", (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/chart`));
app.get("/api/stocks/:symbol/indicators", (req, res) => proxyToPython(req, res, `/stocks/${req.params.symbol}/indicators`));

// ─── Watchlist ────────────────────────────────────────────────────────────────
app.get("/api/watchlist", (req, res) => proxyToPython(req, res, "/watchlist"));
app.put("/api/watchlist", (req, res) => proxyToPython(req, res, "/watchlist", "PUT"));

// ─── Portfolio ────────────────────────────────────────────────────────────────
app.get("/api/portfolio", (req, res) => proxyToPython(req, res, "/portfolio"));
app.get("/api/orders", (req, res) => proxyToPython(req, res, "/orders"));
app.post("/api/orders", (req, res) => proxyToPython(req, res, "/orders", "POST"));

// ─── Backtesting ──────────────────────────────────────────────────────────────
app.post("/api/backtest", (req, res) => proxyToPython(req, res, "/backtest", "POST"));

// ─── AutoTrader ───────────────────────────────────────────────────────────────
app.get("/api/autotrader/status", (req, res) => proxyToPython(req, res, "/autotrader/status"));
app.post("/api/autotrader/start", (req, res) => proxyToPython(req, res, "/autotrader/start", "POST"));
app.post("/api/autotrader/stop", (req, res) => proxyToPython(req, res, "/autotrader/stop", "POST"));
app.get("/api/autotrader/thoughts", (req, res) => proxyToPython(req, res, "/autotrader/thoughts"));

// ─── Broker Mode ─────────────────────────────────────────────────────────────
app.get("/api/broker/status", (req, res) => proxyToPython(req, res, "/broker/status"));
app.post("/api/broker/switch", (req, res) => proxyToPython(req, res, "/broker/switch", "POST"));
app.post("/api/broker/configure", (req, res) => proxyToPython(req, res, "/broker/configure", "POST"));

// ─── Ollama AI Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/ollama/status
 * Check if Ollama is running and list available models.
 */
app.get("/api/ollama/status", async (req, res) => {
  try {
    const status = await ollamaService.getOllamaStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ollama/analyze
 * Body: { symbol: "RELIANCE.NS" }
 * Fetches stock data from Python then runs Ollama analysis.
 * Returns full structured analysis JSON.
 */
app.post("/api/ollama/analyze", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  try {
    // Fetch quote + indicators from Python engine in parallel
    const [quoteRes, indicatorsRes, signalsRes] = await Promise.allSettled([
      axios.get(`${PYTHON_BASE}/stocks/${encodeURIComponent(symbol)}/quote`, { timeout: 15000 }),
      axios.get(`${PYTHON_BASE}/stocks/${encodeURIComponent(symbol)}/indicators`, { timeout: 15000 }),
      axios.get(`${PYTHON_BASE}/signals`, { timeout: 10000 }),
    ]);

    const quote = quoteRes.status === "fulfilled" ? quoteRes.value.data : {};
    const indicators = indicatorsRes.status === "fulfilled" ? indicatorsRes.value.data?.indicators : {};
    const allSignals = signalsRes.status === "fulfilled" ? signalsRes.value.data?.signals : [];
    const signals = allSignals.filter((s) => s.symbol === symbol);

    const analysis = await ollamaService.analyzeStock(symbol, quote, indicators, signals);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ollama/analyze/stream
 * Same as /analyze but streams the response as SSE (Server-Sent Events).
 */
app.post("/api/ollama/analyze/stream", async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: "symbol is required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const [quoteRes, indicatorsRes, signalsRes] = await Promise.allSettled([
      axios.get(`${PYTHON_BASE}/stocks/${encodeURIComponent(symbol)}/quote`, { timeout: 15000 }),
      axios.get(`${PYTHON_BASE}/stocks/${encodeURIComponent(symbol)}/indicators`, { timeout: 15000 }),
      axios.get(`${PYTHON_BASE}/signals`, { timeout: 10000 }),
    ]);

    const quote = quoteRes.status === "fulfilled" ? quoteRes.value.data : {};
    const indicators = indicatorsRes.status === "fulfilled" ? indicatorsRes.value.data?.indicators : {};
    const allSignals = signalsRes.status === "fulfilled" ? signalsRes.value.data?.signals : [];
    const signals = allSignals.filter((s) => s.symbol === symbol);

    res.write(`data: ${JSON.stringify({ type: "start", symbol })}\n\n`);

    await ollamaService.analyzeStockStream(symbol, quote, indicators, signals, (chunk) => {
      res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
    });

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/ollama/sentiment
 * Body: { symbol: "RELIANCE", headlines: ["headline1", ...] }
 */
app.post("/api/ollama/sentiment", async (req, res) => {
  const { symbol, headlines } = req.body;
  if (!symbol || !headlines?.length)
    return res.status(400).json({ error: "symbol and headlines are required" });

  try {
    const result = await ollamaService.analyzeSentiment(symbol, headlines);
    res.json({ symbol, ...result, analyzed_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ollama/model
 * Switch active Ollama model: Body { model: "llama3.2" }
 */
app.post("/api/ollama/model", (req, res) => {
  const { model } = req.body;
  if (!model) return res.status(400).json({ error: "model is required" });
  process.env.OLLAMA_MODEL = model;
  res.json({ success: true, model });
});

// ─── WebSocket Bridge ─────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: "/ws" });
let pythonWS = null;
const frontendClients = new Set();

function connectToPython() {
  pythonWS = new WebSocket(`${PYTHON_BASE.replace("http", "ws")}/ws`);

  pythonWS.on("open", () => {
    console.log("[WS Bridge] Connected to Python engine");
  });

  pythonWS.on("message", (data) => {
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

setTimeout(connectToPython, 2000);

wss.on("connection", (ws, req) => {
  frontendClients.add(ws);
  console.log(`[WS] Frontend client connected. Total: ${frontendClients.size}`);
  ws.send(JSON.stringify({ type: "gateway_connected", timestamp: new Date().toISOString() }));

  ws.on("message", (data) => {
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
╔════════════════════════════════════════════════════╗
║   TradeMind AI Gateway running on :${PORT}            ║
║   Python Engine: ${PYTHON_BASE}            ║
║   Ollama: ${process.env.OLLAMA_URL || "http://localhost:11434"}  ║
║   WebSocket: ws://localhost:${PORT}/ws              ║
╚════════════════════════════════════════════════════╝
  `);

  // Start daily thought-journal email scheduler (3:28 PM IST, weekdays)
  emailScheduler.startScheduler();
});

module.exports = { app, server };
