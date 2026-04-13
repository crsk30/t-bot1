"""
NSE Algo Trading - FastAPI Main Application
===========================================
Serves REST endpoints and WebSocket connections for the Angular frontend
(via the Node.js API gateway).
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from config import settings
from db.models import init_db, get_db, Signal, Trade, AuditLog, PortfolioSnapshot
from data.market_data import market_data
from indicators.technical import add_all_indicators, get_indicator_snapshot
from engine.signal_engine import signal_engine
from engine.risk_manager import risk_manager
from engine.auto_trader import auto_trader
from broker.paper_broker import paper_broker
from broker.kite_broker import kite_broker
from broker.upstox_broker import upstox_broker
from backtest.runner import run_backtest

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

# Active WebSocket connections
ws_connections: list[WebSocket] = []
engine_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialised")

    # Register WS broadcast with signal engine
    async def broadcast(payload: dict):
        dead = []
        for ws in ws_connections:
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            ws_connections.remove(ws)

    signal_engine.subscribe(broadcast)
    auto_trader.set_broadcast(broadcast)

    # Wire AutoTrader to act on every new signal
    original_broadcast = signal_engine._broadcast

    async def signal_and_trade(payload: dict):
        await original_broadcast(payload)
        if auto_trader.is_active and payload.get("type") == "signals_update":
            for sig in payload.get("signals", []):
                await auto_trader.act_on_signal(sig)

    signal_engine._broadcast = signal_and_trade
    global engine_task
    engine_task = asyncio.create_task(signal_engine.run_continuous())
    logger.info("Signal engine started — scanning markets continuously")
    
    await auto_trader.start()
    logger.info("AutoTrader activated — paper trading autonomously")
    yield
    # Cleanup
    signal_engine.stop()
    logger.info("Signal engine stopped cleanly")


app = FastAPI(
    title="NSE Algo Trading Engine",
    version="1.0.0",
    description="Swing trading algorithmic system for NSE India",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Pydantic Models ──────────────────────────────────────────────────────────

# Active broker mode: paper | kite | upstox
active_broker_mode: str = "paper"

class OrderRequest(BaseModel):
    symbol: str
    direction: str   # BUY | SELL
    quantity: int
    order_type: Optional[str] = "MARKET"
    price: Optional[float] = 0.0
    notes: Optional[str] = ""

class BacktestRequest(BaseModel):
    symbol: str
    strategy: str
    start_date: str  # YYYY-MM-DD
    end_date: str
    cash: float = 500000

class WatchlistUpdate(BaseModel):
    symbols: list[str]

class BrokerSwitchRequest(BaseModel):
    mode: str  # paper | kite | upstox

class BrokerConfigRequest(BaseModel):
    broker: str  # kite | upstox
    api_key: str
    api_secret: str
    access_token: Optional[str] = None
    redirect_uri: Optional[str] = None


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "broker": settings.broker,
        "is_paper": True,
        "engine_running": signal_engine.is_running,
        "timestamp": datetime.utcnow().isoformat(),
    }


# ─── Engine Control ───────────────────────────────────────────────────────────

@app.post("/engine/start")
async def start_engine(background_tasks: BackgroundTasks):
    global engine_task
    if signal_engine.is_running:
        return {"status": "already_running"}
    engine_task = asyncio.create_task(signal_engine.run_continuous())
    return {"status": "started"}

@app.post("/engine/stop")
async def stop_engine():
    signal_engine.stop()
    return {"status": "stopped"}

@app.get("/engine/status")
async def engine_status():
    return {
        "running": signal_engine.is_running,
        "scan_count": signal_engine._scan_count,
        "watchlist_size": len(settings.watchlist),
        "strategies": [s.name for s in __import__("engine.signal_engine", fromlist=["STRATEGIES"]).STRATEGIES],
    }

@app.post("/engine/scan")
async def manual_scan():
    """Trigger an immediate scan (for testing / on-demand)."""
    signals = await signal_engine.scan_all()
    return {"signals": signals, "count": len(signals)}


# ─── AutoTrader Control ───────────────────────────────────────────────────────

@app.get("/autotrader/status")
async def autotrader_status():
    return auto_trader.get_stats()

@app.post("/autotrader/start")
async def autotrader_start():
    if not auto_trader.is_active:
        await auto_trader.start()
    return {"status": "active", "stats": auto_trader.get_stats()}

@app.post("/autotrader/stop")
async def autotrader_stop():
    auto_trader.stop()
    return {"status": "stopped"}

@app.get("/autotrader/thoughts")
async def autotrader_thoughts(limit: int = 100):
    return {"thoughts": auto_trader.get_thought_journal(limit)}




# ─── Signals ──────────────────────────────────────────────────────────────────

@app.get("/signals")
async def get_signals():
    return {"signals": signal_engine.get_latest_signals()}

@app.get("/signals/scan")
async def scan_now():
    signals = await signal_engine.scan_all()
    return {"signals": signals, "count": len(signals)}


# ─── Market Data ──────────────────────────────────────────────────────────────

@app.get("/stocks/{symbol}/quote")
async def get_quote(symbol: str):
    return market_data.get_quote(symbol)

@app.get("/stocks/{symbol}/chart")
async def get_chart(symbol: str, period: str = "6mo", interval: str = "1d"):
    data = market_data.get_chart_data(symbol, period=period, interval=interval)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")
    return {"symbol": symbol, "data": data}

@app.get("/stocks/{symbol}/indicators")
async def get_indicators(symbol: str):
    df = market_data.get_ohlcv(symbol, period="1y")
    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")
    df = add_all_indicators(df)
    return {"symbol": symbol, "indicators": get_indicator_snapshot(df)}

@app.get("/stocks/quotes/batch")
async def get_batch_quotes(symbols: str):
    """Get quotes for multiple symbols (comma-separated)."""
    sym_list = [s.strip() for s in symbols.split(",")]
    return {sym: market_data.get_quote(sym) for sym in sym_list[:20]}


# ─── Watchlist ─────────────────────────────────────────────────────────────────

@app.get("/watchlist")
async def get_watchlist():
    return {"watchlist": settings.watchlist}

@app.put("/watchlist")
async def update_watchlist(body: WatchlistUpdate):
    settings.watchlist = [s.strip().upper() for s in body.symbols]
    market_data.clear_cache()
    return {"watchlist": settings.watchlist}


# ─── Portfolio ─────────────────────────────────────────────────────────────────

@app.get("/portfolio")
async def get_portfolio():
    symbols = list(paper_broker.positions.keys())
    prices  = {sym: (market_data.get_latest_price(sym) or 0) for sym in symbols}
    return paper_broker.get_portfolio_value(prices)

@app.get("/orders")
async def get_orders(limit: int = 50):
    return {"orders": paper_broker.get_order_history(limit)}


# ─── Order Placement ──────────────────────────────────────────────────────────

@app.post("/orders")
async def place_order(req: OrderRequest):
    global active_broker_mode
    price = market_data.get_latest_price(req.symbol)
    if not price:
        raise HTTPException(status_code=400, detail=f"Could not fetch price for {req.symbol}")

    if active_broker_mode == "kite":
        if not kite_broker.is_connected():
            raise HTTPException(status_code=400, detail="Kite broker not connected")
        result = kite_broker.place_order(
            symbol=req.symbol,
            direction=req.direction.upper(),
            quantity=req.quantity,
            order_type=req.order_type or "MARKET",
            price=req.price or 0.0,
            notes=req.notes or ""
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    elif active_broker_mode == "upstox":
        if not upstox_broker.is_connected():
            raise HTTPException(status_code=400, detail="Upstox broker not connected")
        result = upstox_broker.place_order(
            symbol=req.symbol,
            direction=req.direction.upper(),
            quantity=req.quantity,
            order_type=req.order_type or "MARKET",
            price=req.price or 0.0,
            notes=req.notes or ""
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    else:
        # Default: paper trading
        order = paper_broker.place_order(
            symbol=req.symbol,
            direction=req.direction.upper(),
            quantity=req.quantity,
            current_price=price,
            notes=req.notes or ""
        )
        return {
            "order_id":    order.order_id,
            "status":      order.status,
            "filled_price":order.filled_price,
            "brokerage":   order.brokerage,
            "notes":       order.notes,
            "mode":        "paper",
        }


# ─── Broker Mode ──────────────────────────────────────────────────────────────

@app.get("/broker/status")
async def broker_status():
    global active_broker_mode
    if active_broker_mode == "kite":
        connected = kite_broker.is_connected()
        profile = kite_broker.get_profile() if connected else {}
    elif active_broker_mode == "upstox":
        connected = upstox_broker.is_connected()
        profile = upstox_broker.get_profile() if connected else {}
    else:
        connected = True
        profile = {"name": "Paper Trader", "capital": paper_broker._cash}
    return {
        "mode": active_broker_mode,
        "connected": connected,
        "profile": profile,
        "available_modes": ["paper", "kite", "upstox"]
    }

@app.post("/broker/switch")
async def switch_broker(req: BrokerSwitchRequest):
    global active_broker_mode
    if req.mode not in ["paper", "kite", "upstox"]:
        raise HTTPException(status_code=400, detail="Invalid broker mode")
    active_broker_mode = req.mode
    return {"mode": active_broker_mode, "status": "switched"}

@app.post("/broker/configure")
async def configure_broker(req: BrokerConfigRequest):
    global active_broker_mode
    if req.broker == "kite":
        kite_broker.api_key = req.api_key
        kite_broker.api_secret = req.api_secret
        if req.access_token:
            kite_broker.connect(req.access_token)
        login_url = ""
        try:
            login_url = kite_broker.get_login_url()
        except Exception:
            pass
        return {
            "broker": "kite",
            "configured": True,
            "connected": kite_broker.is_connected(),
            "login_url": login_url
        }
    elif req.broker == "upstox":
        upstox_broker.api_key = req.api_key
        upstox_broker.api_secret = req.api_secret
        if req.redirect_uri:
            upstox_broker.redirect_uri = req.redirect_uri
        if req.access_token:
            upstox_broker.connect(req.access_token)
        login_url = ""
        try:
            login_url = upstox_broker.get_login_url()
        except Exception:
            pass
        return {
            "broker": "upstox",
            "configured": True,
            "connected": upstox_broker.is_connected(),
            "login_url": login_url
        }
    raise HTTPException(status_code=400, detail="Unknown broker")

@app.get("/broker/kite/login-url")
async def kite_login_url():
    try:
        url = kite_broker.get_login_url()
        return {"login_url": url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/broker/upstox/login-url")
async def upstox_login_url():
    try:
        url = upstox_broker.get_login_url()
        return {"login_url": url}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ─── Backtesting ──────────────────────────────────────────────────────────────

@app.post("/backtest")
async def backtest(req: BacktestRequest):
    result = await asyncio.get_event_loop().run_in_executor(
        None,
        run_backtest,
        req.symbol, req.strategy, req.start_date, req.end_date, req.cash
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    ws_connections.append(ws)
    logger.info(f"WebSocket client connected. Total: {len(ws_connections)}")

    # Send current signals immediately on connect
    await ws.send_text(json.dumps({
        "type":    "connected",
        "signals": signal_engine.get_latest_signals(),
        "portfolio": paper_broker.get_portfolio_value({}),
        "timestamp": datetime.utcnow().isoformat(),
    }))

    try:
        while True:
            data = await ws.receive_text()
            msg  = json.loads(data)

            if msg.get("type") == "ping":
                await ws.send_text(json.dumps({"type": "pong", "ts": datetime.utcnow().isoformat()}))
            elif msg.get("type") == "subscribe_prices":
                # Client wants live price updates for specific symbols
                await ws.send_text(json.dumps({"type": "subscribed", "symbols": msg.get("symbols", [])}))

    except WebSocketDisconnect:
        ws_connections.remove(ws)
        logger.info(f"WebSocket client disconnected. Total: {len(ws_connections)}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if ws in ws_connections:
            ws_connections.remove(ws)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=settings.debug)
