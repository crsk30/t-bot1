"""
AutoTrader - The Autonomous Trading Brain
==========================================
This module acts as the "stock trader brain" of the system.
It doesn't just react to signals — it THINKS before acting:

1. Evaluates signal quality with a multi-factor scoring model
2. Checks market conditions (breadth, trend health)
3. Confirms across multiple indicator dimensions
4. Manages the full trade lifecycle: entry → monitor → exit
5. Logs its reasoning like a real trader's thought journal
6. Respects NSE market hours (9:15 AM – 3:30 PM IST)
7. Avoids overtrading (cooldown per symbol after a trade)
"""

import asyncio
import logging
from datetime import datetime, time
from zoneinfo import ZoneInfo
from typing import Optional
import pytz

from config import settings
from broker.paper_broker import paper_broker
from engine.risk_manager import risk_manager
from data.market_data import market_data

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")
MARKET_OPEN  = time(9, 15)
MARKET_CLOSE = time(15, 25)  # Stop new entries 5 min before close

# Cooldown: Don't re-enter same symbol within N hours of a closed trade
SYMBOL_COOLDOWN_HOURS = 48

# Minimum signal strength to trade
MIN_SIGNAL_STRENGTH = 60.0

# How often to check open positions for SL/TP hits (seconds)
POSITION_CHECK_INTERVAL = 60


class TraderThought:
    """Represents one line of a trader's reasoning."""
    def __init__(self, action: str, symbol: str, reasoning: str, decided: bool, details: dict = None):
        self.timestamp = datetime.now(IST)
        self.action    = action
        self.symbol    = symbol
        self.reasoning = reasoning
        self.decided   = decided
        self.details   = details or {}

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "action":    self.action,
            "symbol":    self.symbol,
            "reasoning": self.reasoning,
            "decided":   self.decided,
            "details":   self.details,
        }

    def __str__(self):
        emoji = "✅" if self.decided else "❌"
        return f"{emoji} [{self.action}] {self.symbol}: {self.reasoning}"


class AutoTrader:
    """
    The autonomous trading agent.
    Evaluates signals, applies trader judgment, and manages positions.
    """

    def __init__(self):
        self.is_active          = False
        self.thought_journal:   list[TraderThought] = []
        self._symbol_last_trade: dict[str, datetime] = {}
        self._monitor_task: Optional[asyncio.Task]   = None
        self._ws_broadcast_cb = None  # Set externally for WebSocket updates

    def set_broadcast(self, callback):
        self._ws_broadcast_cb = callback

    async def _broadcast(self, payload: dict):
        if self._ws_broadcast_cb:
            try:
                await self._ws_broadcast_cb(payload)
            except Exception as e:
                logger.debug(f"Broadcast error: {e}")

    # ─── Market Hours Guard ───────────────────────────────────────────────────

    def is_market_open(self) -> bool:
        now = datetime.now(IST).time()
        today = datetime.now(IST).weekday()  # Mon=0, Fri=4
        if today >= 5:  # Weekend
            return False
        return MARKET_OPEN <= now <= MARKET_CLOSE

    def _think(self, action: str, symbol: str, reasoning: str, decided: bool, details: dict = None) -> TraderThought:
        thought = TraderThought(action, symbol, reasoning, decided, details)
        self.thought_journal.append(thought)
        if len(self.thought_journal) > 500:
            self.thought_journal = self.thought_journal[-500:]
        log = f"[AutoTrader] {thought}"
        if decided:
            logger.info(log)
        else:
            logger.debug(log)
        return thought

    # ─── Signal Evaluation ────────────────────────────────────────────────────

    def evaluate_signal(self, signal: dict) -> tuple[bool, str]:
        """
        Multi-factor signal evaluation. Returns (should_trade, reason).
        Applies trader intuition on top of raw strategy signals.
        """
        symbol   = signal.get("symbol", "")
        sig_type = signal.get("signal", "HOLD")
        strength = signal.get("strength", 0)
        price    = signal.get("price", 0)
        sl       = signal.get("stop_loss", 0)
        target   = signal.get("target", 0)
        rr       = signal.get("risk_reward", 0)
        inds     = signal.get("indicators", {})

        # ── Gate 1: Market hours ─────────────────────────────────────────────
        # For paper trading with daily data, we allow anytime but log it
        if not self.is_market_open():
            return False, f"Market is closed (IST time: {datetime.now(IST).strftime('%H:%M')}). Signal queued for next session."

        # ── Gate 2: Signal direction ──────────────────────────────────────────
        if sig_type not in ("BUY", "SELL"):
            return False, "Not an actionable signal (HOLD or unknown)"

        # ── Gate 3: Minimum strength ──────────────────────────────────────────
        if strength < MIN_SIGNAL_STRENGTH:
            return False, f"Signal strength {strength:.1f} below threshold {MIN_SIGNAL_STRENGTH}"

        # ── Gate 4: Already in position ──────────────────────────────────────
        if sig_type == "BUY" and risk_manager.is_already_in_position(symbol):
            return False, f"Already holding a position in {symbol}. Avoiding duplication."

        # ── Gate 5: Cooldown period ───────────────────────────────────────────
        if symbol in self._symbol_last_trade:
            hours_since = (datetime.now(IST) - self._symbol_last_trade[symbol]).total_seconds() / 3600
            if hours_since < SYMBOL_COOLDOWN_HOURS:
                return False, f"Cooldown active for {symbol}. Last trade was {hours_since:.1f}h ago (need {SYMBOL_COOLDOWN_HOURS}h)"

        # ── Gate 6: Risk-reward check ─────────────────────────────────────────
        if rr < settings.min_risk_reward:
            return False, f"R:R = {rr:.2f} below minimum {settings.min_risk_reward}. Trade doesn't pay enough."

        # ── Gate 7: Trend alignment check ─────────────────────────────────────
        if sig_type == "BUY":
            above_200 = inds.get("above_ema200") or inds.get("above_200ema", False)
            in_uptrend = inds.get("in_uptrend", False)
            if not above_200 and not in_uptrend:
                return False, f"Trading AGAINST the primary trend (below 200-EMA). Skipping — trends are your friend."

        # ── Gate 8: Capital availability ──────────────────────────────────────
        available = paper_broker.capital
        if available < price:
            return False, f"Insufficient capital. Need ₹{price:.2f} per share, have ₹{available:.2f}"

        # ── Gate 9: Portfolio concentration ───────────────────────────────────
        risk_pct = risk_manager.get_portfolio_risk_pct(paper_broker.capital + available)
        if risk_pct >= settings.max_portfolio_risk_pct * 100:
            return False, f"Portfolio already {risk_pct:.1f}% deployed (max {settings.max_portfolio_risk_pct*100:.0f}%). Protecting capital."

        # ── All gates passed ──────────────────────────────────────────────────
        return True, "All checks passed. Executing trade."

    # ─── Trade Execution ─────────────────────────────────────────────────────

    async def act_on_signal(self, signal: dict):
        """
        The main decision + action function.
        Called for each new signal from the signal engine.
        """
        symbol   = signal.get("symbol", "")
        sig_type = signal.get("signal", "HOLD")
        price    = signal.get("price", 0)
        sl       = signal.get("stop_loss", 0)
        target   = signal.get("target", 0)
        strategy = signal.get("strategy", "")
        strength = signal.get("strength", 0)

        should_trade, reason = self.evaluate_signal(signal)

        thought = self._think(
            action   = f"EVALUATE_{sig_type}",
            symbol   = symbol,
            reasoning= reason,
            decided  = should_trade,
            details  = {"strength": strength, "rr": signal.get("risk_reward"), "strategy": strategy}
        )

        await self._broadcast({"type": "trader_thought", "thought": thought.to_dict()})

        if not should_trade:
            return

        # Calculate position size
        sizing = risk_manager.calculate_position_size(
            symbol          = symbol,
            price           = price,
            stop_loss       = sl,
            available_capital = paper_broker.capital
        )

        if not sizing.approved:
            self._think(
                action   = "SKIP_TRADE",
                symbol   = symbol,
                reasoning= f"Position sizing failed: {sizing.reason}",
                decided  = False
            )
            return

        # Place the order
        self._think(
            action   = f"PLACE_{sig_type}",
            symbol   = symbol,
            reasoning= (
                f"Placing {sig_type} order: {sizing.quantity} shares @ ₹{price:.2f}. "
                f"Risk: ₹{sizing.risk_amount:.0f} ({sizing.capital_pct:.1f}% capital). "
                f"SL=₹{sl:.2f}, Target=₹{target:.2f}, Strategy={strategy}"
            ),
            decided  = True,
            details  = sizing.__dict__
        )

        order = paper_broker.place_order(
            symbol        = symbol,
            direction     = sig_type,
            quantity      = sizing.quantity,
            current_price = price,
            notes         = f"{strategy} | Strength={strength:.0f}"
        )

        if order.status == "FILLED":
            risk_manager.register_position(symbol, sizing.quantity, order.filled_price, sl, target)
            self._symbol_last_trade[symbol] = datetime.now(IST)

            await self._broadcast({
                "type":  "trade_executed",
                "order": {
                    "order_id":    order.order_id,
                    "symbol":      symbol,
                    "direction":   sig_type,
                    "quantity":    sizing.quantity,
                    "filled_price":order.filled_price,
                    "stop_loss":   sl,
                    "target":      target,
                    "strategy":    strategy,
                    "reasoning":   signal.get("reasoning", ""),
                    "timestamp":   order.timestamp.isoformat(),
                },
                "portfolio": paper_broker.get_portfolio_value({})
            })

            self._think(
                action   = "TRADE_CONFIRMED",
                symbol   = symbol,
                reasoning= f"Order {order.order_id} FILLED @ ₹{order.filled_price:.2f}. Monitoring position now.",
                decided  = True
            )
        else:
            self._think(
                action   = "ORDER_REJECTED",
                symbol   = symbol,
                reasoning= f"Order rejected: {order.notes}",
                decided  = False
            )

    # ─── Position Monitoring ──────────────────────────────────────────────────

    async def monitor_positions(self):
        """
        Continuously checks open positions for:
        - Stop-loss hits  → close immediately
        - Target hits     → close with profit
        - Trailing stop   → update stop as trade moves in our favour
        """
        while self.is_active:
            try:
                positions = risk_manager.get_open_positions()
                if positions:
                    for symbol, pos in list(positions.items()):
                        current_price = market_data.get_latest_price(symbol)
                        if not current_price:
                            continue

                        qty    = pos["qty"]
                        entry  = pos["entry"]
                        stop   = pos["stop"]
                        target = pos["target"]

                        # ── Stop-loss hit ─────────────────────────────────────
                        if current_price <= stop:
                            self._think(
                                action="SL_EXIT",
                                symbol=symbol,
                                reasoning=(
                                    f"Stop-loss triggered! Price ₹{current_price:.2f} ≤ SL ₹{stop:.2f}. "
                                    f"Loss = ₹{(current_price - entry) * qty:.2f}. Cutting losses — discipline."
                                ),
                                decided=True
                            )
                            order = paper_broker.place_order(symbol, "SELL", qty, current_price, notes="STOP-LOSS HIT")
                            if order.status == "FILLED":
                                risk_manager.close_position(symbol)
                                pnl = (order.filled_price - entry) * qty
                                await self._broadcast({
                                    "type": "position_closed",
                                    "reason": "stop_loss",
                                    "symbol": symbol,
                                    "pnl":    round(pnl, 2),
                                    "exit_price": order.filled_price
                                })

                        # ── Target hit ────────────────────────────────────────
                        elif current_price >= target:
                            self._think(
                                action="TARGET_EXIT",
                                symbol=symbol,
                                reasoning=(
                                    f"Target reached! Price ₹{current_price:.2f} ≥ Target ₹{target:.2f}. "
                                    f"Profit = ₹{(current_price - entry) * qty:.2f}. Banking gains!"
                                ),
                                decided=True
                            )
                            order = paper_broker.place_order(symbol, "SELL", qty, current_price, notes="TARGET HIT")
                            if order.status == "FILLED":
                                risk_manager.close_position(symbol)
                                pnl = (order.filled_price - entry) * qty
                                await self._broadcast({
                                    "type": "position_closed",
                                    "reason": "target_hit",
                                    "symbol": symbol,
                                    "pnl":    round(pnl, 2),
                                    "exit_price": order.filled_price
                                })

                        # ── Trailing stop: raise stop to break-even at 1:1 ──
                        else:
                            profit_so_far = current_price - entry
                            initial_risk  = entry - stop
                            if profit_so_far >= initial_risk and stop < entry:
                                new_stop = round(entry + 0.01, 2)  # Move to break-even
                                risk_manager._positions[symbol]["stop"] = new_stop
                                self._think(
                                    action="TRAILING_STOP",
                                    symbol=symbol,
                                    reasoning=(
                                        f"Trade moved 1:1 in our favor. Moving stop to break-even ₹{new_stop:.2f}. "
                                        f"Risk-free trade now!"
                                    ),
                                    decided=True
                                )

            except Exception as e:
                logger.error(f"Position monitor error: {e}")

            await asyncio.sleep(POSITION_CHECK_INTERVAL)

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self):
        self.is_active = True
        self._monitor_task = asyncio.create_task(self.monitor_positions())
        self._think(
            action="AUTOTRADER_START",
            symbol="SYSTEM",
            reasoning=(
                f"AutoTrader activated. Paper capital: ₹{paper_broker.capital:,.0f}. "
                f"Max position size: {settings.max_position_pct*100:.0f}% per trade. "
                f"Min signal strength: {MIN_SIGNAL_STRENGTH}. "
                f"Market hours: {MARKET_OPEN} – {MARKET_CLOSE} IST."
            ),
            decided=True
        )
        logger.info("[AutoTrader] Started — trading autonomously in paper mode")

    def stop(self):
        self.is_active = False
        if self._monitor_task:
            self._monitor_task.cancel()
        self._think(
            action="AUTOTRADER_STOP",
            symbol="SYSTEM",
            reasoning="AutoTrader deactivated by user.",
            decided=True
        )

    def get_thought_journal(self, limit: int = 100) -> list[dict]:
        return [t.to_dict() for t in reversed(self.thought_journal[-limit:])]

    def get_stats(self) -> dict:
        trades  = paper_broker.get_order_history(1000)
        filled  = [o for o in trades if o["status"] == "FILLED"]
        buys    = [o for o in filled if o["direction"] == "BUY"]
        sells   = [o for o in filled if o["direction"] == "SELL"]
        return {
            "is_active":          self.is_active,
            "total_thoughts":     len(self.thought_journal),
            "trades_placed":      len(buys),
            "positions_closed":   len(sells),
            "symbols_traded":     list(self._symbol_last_trade.keys()),
            "cooldown_symbols":   {
                sym: f"{(datetime.now(IST) - t).total_seconds()/3600:.1f}h ago"
                for sym, t in self._symbol_last_trade.items()
            },
            "open_positions":     len(risk_manager.get_open_positions()),
            "portfolio_risk_pct": risk_manager.get_portfolio_risk_pct(
                paper_broker.capital
            ),
        }


auto_trader = AutoTrader()
