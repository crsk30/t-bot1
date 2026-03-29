"""
Risk Manager
============
Enforces position sizing, max capital deployment, and stop-loss rules.
All calculations are based on the current portfolio state.
"""
from dataclasses import dataclass
from config import settings
import logging

logger = logging.getLogger(__name__)


@dataclass
class PositionSizing:
    symbol: str
    quantity: int
    position_value: float
    risk_amount: float
    capital_pct: float
    approved: bool
    reason: str


class RiskManager:
    def __init__(self, capital: float = None):
        self.initial_capital = capital or settings.paper_capital
        self._positions: dict[str, dict] = {}  # symbol -> {qty, entry, stop}

    def calculate_position_size(
        self,
        symbol: str,
        price: float,
        stop_loss: float,
        available_capital: float
    ) -> PositionSizing:
        """
        Calculate how many shares to buy based on:
        - Max position size (% of capital)
        - Risk per trade (loss if stop-loss is hit)
        - Available capital
        """
        if price <= 0 or stop_loss <= 0 or stop_loss >= price:
            return PositionSizing(
                symbol=symbol, quantity=0, position_value=0,
                risk_amount=0, capital_pct=0, approved=False,
                reason="Invalid price or stop-loss"
            )

        risk_per_share = price - stop_loss
        if risk_per_share <= 0:
            return PositionSizing(
                symbol=symbol, quantity=0, position_value=0,
                risk_amount=0, capital_pct=0, approved=False,
                reason="Stop loss must be below entry price"
            )

        # Max capital to allocate per position
        max_position_value = available_capital * settings.max_position_pct

        # Shares based on position size limit
        qty_by_position = int(max_position_value / price)

        # Check total portfolio deployment
        total_deployed = sum(p.get("value", 0) for p in self._positions.values())
        max_total   = available_capital * settings.max_portfolio_risk_pct
        remaining   = max_total - total_deployed

        if remaining <= 0:
            return PositionSizing(
                symbol=symbol, quantity=0, position_value=0,
                risk_amount=0, capital_pct=0, approved=False,
                reason=f"Max portfolio deployment ({settings.max_portfolio_risk_pct*100:.0f}%) reached"
            )

        qty_by_portfolio = int(min(remaining, max_position_value) / price)
        quantity = min(qty_by_position, qty_by_portfolio)

        if quantity < 1:
            return PositionSizing(
                symbol=symbol, quantity=0, position_value=0,
                risk_amount=0, capital_pct=0, approved=False,
                reason="Insufficient capital for minimum 1 share"
            )

        position_value = round(quantity * price, 2)
        risk_amount    = round(quantity * risk_per_share, 2)
        capital_pct    = round(position_value / available_capital * 100, 2)

        return PositionSizing(
            symbol=symbol, quantity=quantity,
            position_value=position_value, risk_amount=risk_amount,
            capital_pct=capital_pct, approved=True,
            reason=f"Approved: {quantity} shares @ ₹{price:.2f} = ₹{position_value:.2f} ({capital_pct:.1f}% capital)"
        )

    def check_risk_reward(self, price: float, stop_loss: float, target: float) -> bool:
        """Ensure minimum risk:reward ratio is met."""
        risk   = abs(price - stop_loss)
        reward = abs(target - price)
        if risk == 0:
            return False
        rr = reward / risk
        if rr < settings.min_risk_reward:
            logger.debug(f"RR {rr:.1f} below minimum {settings.min_risk_reward}")
            return False
        return True

    def register_position(self, symbol: str, quantity: int, entry_price: float,
                          stop_loss: float, target: float):
        self._positions[symbol] = {
            "qty": quantity,
            "entry": entry_price,
            "stop": stop_loss,
            "target": target,
            "value": quantity * entry_price
        }

    def close_position(self, symbol: str):
        self._positions.pop(symbol, None)

    def get_open_positions(self) -> dict:
        return dict(self._positions)

    def get_portfolio_risk_pct(self, available_capital: float) -> float:
        total_deployed = sum(p.get("value", 0) for p in self._positions.values())
        return round(total_deployed / available_capital * 100, 2) if available_capital > 0 else 0.0

    def is_already_in_position(self, symbol: str) -> bool:
        return symbol in self._positions


risk_manager = RiskManager()
