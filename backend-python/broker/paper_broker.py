"""
Paper Trading Broker
====================
Simulates order execution at market price for backtesting
and paper trading. No real money involved.
"""
import uuid
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from config import settings
import logging

logger = logging.getLogger(__name__)


@dataclass
class Order:
    order_id: str
    symbol: str
    direction: str       # BUY | SELL
    quantity: int
    order_type: str      # MARKET | LIMIT
    price: float         # limit price (ignored for MARKET)
    filled_price: float = 0.0
    status: str = "PENDING"   # PENDING | FILLED | CANCELLED | REJECTED
    timestamp: datetime = field(default_factory=datetime.utcnow)
    fill_timestamp: Optional[datetime] = None
    brokerage: float = 0.0
    notes: str = ""


class PaperBroker:
    """Simulates a SEBI-compliant broker for paper trading."""

    def __init__(self, initial_capital: float = None):
        self.capital = initial_capital or settings.paper_capital
        self.initial_capital = self.capital
        self.positions: dict[str, dict] = {}   # symbol -> {qty, avg_price}
        self.orders: list[Order] = []
        self.brokerage_pct = settings.paper_brokerage_pct
        self.is_paper = True

    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: int,
        current_price: float,
        order_type: str = "MARKET",
        limit_price: float = 0.0,
        notes: str = ""
    ) -> Order:
        """Place a simulated order, fills immediately at current price."""
        order_id     = str(uuid.uuid4())[:8].upper()
        fill_price   = current_price  # market order = instant fill

        # Simulate slippage: 0.05% for market orders
        slippage     = fill_price * 0.0005
        if direction == "BUY":
            fill_price += slippage
        else:
            fill_price -= slippage

        fill_price   = round(fill_price, 2)
        trade_value  = fill_price * quantity
        brokerage    = round(trade_value * self.brokerage_pct, 2)
        stt          = round(trade_value * 0.001, 2) if direction == "SELL" else 0  # STT on sell side

        order = Order(
            order_id=order_id, symbol=symbol, direction=direction,
            quantity=quantity, order_type=order_type,
            price=limit_price or current_price,
            filled_price=fill_price, status="PENDING",
            notes=notes, brokerage=brokerage
        )

        # Validate
        if direction == "BUY":
            cost = trade_value + brokerage + stt
            if cost > self.capital:
                order.status = "REJECTED"
                order.notes  = f"Insufficient capital. Need ₹{cost:.2f}, have ₹{self.capital:.2f}"
                logger.warning(f"[PAPER] Order rejected for {symbol}: {order.notes}")
                self.orders.append(order)
                return order

            self.capital -= cost
            if symbol in self.positions:
                # Average down/up
                old_qty = self.positions[symbol]["qty"]
                old_avg = self.positions[symbol]["avg_price"]
                new_qty = old_qty + quantity
                new_avg = (old_qty * old_avg + quantity * fill_price) / new_qty
                self.positions[symbol] = {"qty": new_qty, "avg_price": round(new_avg, 2)}
            else:
                self.positions[symbol] = {"qty": quantity, "avg_price": fill_price}

        elif direction == "SELL":
            if symbol not in self.positions or self.positions[symbol]["qty"] < quantity:
                order.status = "REJECTED"
                order.notes  = f"Insufficient position to sell {quantity} shares of {symbol}"
                logger.warning(f"[PAPER] Order rejected: {order.notes}")
                self.orders.append(order)
                return order

            proceeds = trade_value - brokerage - stt
            self.capital += proceeds

            new_qty = self.positions[symbol]["qty"] - quantity
            if new_qty == 0:
                del self.positions[symbol]
            else:
                self.positions[symbol]["qty"] = new_qty

        order.status         = "FILLED"
        order.filled_price   = fill_price
        order.fill_timestamp = datetime.utcnow()
        self.orders.append(order)

        logger.info(
            f"[PAPER] {direction} {quantity} {symbol} @ ₹{fill_price:.2f} | "
            f"Brokerage: ₹{brokerage:.2f} | Capital: ₹{self.capital:.2f}"
        )
        return order

    def get_portfolio_value(self, current_prices: dict[str, float]) -> dict:
        """Calculate current portfolio value and P&L."""
        invested = 0.0
        positions_detail = []

        for symbol, pos in self.positions.items():
            qty       = pos["qty"]
            avg_price = pos["avg_price"]
            cur_price = current_prices.get(symbol, avg_price)
            cur_value = qty * cur_price
            cost      = qty * avg_price
            pnl       = cur_value - cost
            pnl_pct   = (pnl / cost * 100) if cost > 0 else 0

            invested += cur_value
            positions_detail.append({
                "symbol":     symbol,
                "qty":        qty,
                "avg_price":  avg_price,
                "cur_price":  round(cur_price, 2),
                "cur_value":  round(cur_value, 2),
                "pnl":        round(pnl, 2),
                "pnl_pct":   round(pnl_pct, 2),
            })

        total_value  = self.capital + invested
        total_pnl    = total_value - self.initial_capital
        total_pnl_pct = (total_pnl / self.initial_capital * 100) if self.initial_capital > 0 else 0

        return {
            "cash":         round(self.capital, 2),
            "invested":     round(invested, 2),
            "total_value":  round(total_value, 2),
            "total_pnl":    round(total_pnl, 2),
            "total_pnl_pct":round(total_pnl_pct, 2),
            "positions":    positions_detail,
        }

    def get_order_history(self, limit: int = 50) -> list[dict]:
        return [
            {
                "order_id":    o.order_id,
                "symbol":      o.symbol,
                "direction":   o.direction,
                "quantity":    o.quantity,
                "filled_price":o.filled_price,
                "status":      o.status,
                "brokerage":   o.brokerage,
                "timestamp":   o.timestamp.isoformat(),
                "notes":       o.notes,
            }
            for o in reversed(self.orders[-limit:])
        ]


paper_broker = PaperBroker()
