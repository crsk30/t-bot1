"""
Signal Engine
=============
Runs all strategies across the watchlist and aggregates signals.
Broadcasts results via WebSocket to connected clients.
"""
import asyncio
import logging
from datetime import datetime
from typing import Callable, Awaitable

from config import settings
from data.market_data import market_data
from indicators.technical import add_all_indicators
from strategies.ema_rsi import EMACrossoverRSI
from strategies.pullback_ema import PullbackToEMA
from strategies.volatility_vwap import BollingerSqueeze, VWAPDeviation
from strategies.base import SignalResult

logger = logging.getLogger(__name__)

# All active strategies
STRATEGIES = [
    EMACrossoverRSI(),
    PullbackToEMA(),
    BollingerSqueeze(),
    VWAPDeviation(),
]


class SignalEngine:
    def __init__(self):
        self.is_running = False
        self._subscribers: list[Callable[[dict], Awaitable[None]]] = []
        self._latest_signals: list[dict] = []
        self._scan_count = 0

    def subscribe(self, callback: Callable):
        """Register a WebSocket callback to receive signal events."""
        self._subscribers.append(callback)

    def unsubscribe(self, callback: Callable):
        if callback in self._subscribers:
            self._subscribers.remove(callback)

    async def _broadcast(self, payload: dict):
        dead = []
        for cb in self._subscribers:
            try:
                await cb(payload)
            except Exception:
                dead.append(cb)
        for cb in dead:
            self.unsubscribe(cb)

    async def scan_all(self, watchlist: list[str] = None) -> list[dict]:
        """
        Scan the entire watchlist with all strategies.
        Returns a list of signal dicts.
        """
        symbols = watchlist or settings.watchlist
        all_signals = []
        self._scan_count += 1

        logger.info(f"[Scan #{self._scan_count}] Scanning {len(symbols)} symbols with {len(STRATEGIES)} strategies")

        for symbol in symbols:
            try:
                df = market_data.get_ohlcv(symbol, period="2y", interval="1d")
                if df.empty or len(df) < 50:
                    continue

                df = add_all_indicators(df)

                for strategy in STRATEGIES:
                    signal: SignalResult = strategy.generate_signal(symbol, df)
                    if signal and signal.signal in ("BUY", "SELL"):
                        signal_dict = {
                            "id":         f"{symbol}_{strategy.name}_{datetime.utcnow().strftime('%H%M%S')}",
                            "symbol":     signal.symbol,
                            "strategy":   signal.strategy,
                            "signal":     signal.signal,
                            "strength":   signal.strength,
                            "price":      signal.price,
                            "stop_loss":  signal.stop_loss,
                            "target":     signal.target,
                            "risk_reward":signal.risk_reward,
                            "reasoning":  signal.reasoning,
                            "indicators": signal.indicators,
                            "timestamp":  datetime.utcnow().isoformat(),
                        }
                        all_signals.append(signal_dict)
                        logger.info(
                            f"[Signal] {signal.signal} {symbol} via {strategy.name} "
                            f"@ ₹{signal.price:.2f} | Strength={signal.strength:.0f}"
                        )

            except Exception as e:
                logger.error(f"Error scanning {symbol}: {e}")
                continue

            # Small delay to avoid hammering yfinance
            await asyncio.sleep(0.1)

        # Sort by strength descending
        all_signals.sort(key=lambda x: x["strength"], reverse=True)
        self._latest_signals = all_signals

        # Broadcast to WebSocket subscribers
        await self._broadcast({
            "type":    "signals_update",
            "scan_id": self._scan_count,
            "count":   len(all_signals),
            "signals": all_signals,
            "scanned_at": datetime.utcnow().isoformat(),
        })

        return all_signals

    def get_latest_signals(self) -> list[dict]:
        return self._latest_signals

    async def run_continuous(self):
        """Main engine loop – runs scans on the configured interval."""
        self.is_running = True
        logger.info(f"Signal engine started. Scan interval: {settings.scan_interval_seconds}s")

        while self.is_running:
            try:
                await self.scan_all()
            except Exception as e:
                logger.error(f"Engine scan error: {e}")

            # Wait for next scan
            for _ in range(settings.scan_interval_seconds):
                if not self.is_running:
                    break
                await asyncio.sleep(1)

        logger.info("Signal engine stopped.")

    def stop(self):
        self.is_running = False


signal_engine = SignalEngine()
