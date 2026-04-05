"""
NSE Algo Trading — Zerodha Kite Broker
========================================
Real money trading via Kite Connect API.
Implements the same interface as paper_broker.py.

Setup:
  pip install kiteconnect
  Set env vars: KITE_API_KEY, KITE_API_SECRET
  Complete login flow to get access_token
"""
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from kiteconnect import KiteConnect
    KITE_AVAILABLE = True
except ImportError:
    KITE_AVAILABLE = False
    logger.warning("kiteconnect not installed. Run: pip install kiteconnect")


class KiteBroker:
    """
    Zerodha Kite broker adapter.
    Matches the interface expected by the system.
    """

    def __init__(self, api_key: str, api_secret: str, access_token: Optional[str] = None):
        self.api_key = api_key
        self.api_secret = api_secret
        self.access_token = access_token
        self._kite: Optional["KiteConnect"] = None
        self._connected = False

    def connect(self, access_token: str) -> bool:
        """Connect using a pre-obtained access token."""
        if not KITE_AVAILABLE:
            raise RuntimeError("kiteconnect package is not installed")
        self._kite = KiteConnect(api_key=self.api_key)
        self._kite.set_access_token(access_token)
        self.access_token = access_token
        self._connected = True
        logger.info("Kite broker connected successfully")
        return True

    def get_login_url(self) -> str:
        """Return the OAuth login URL for Zerodha."""
        if not KITE_AVAILABLE:
            raise RuntimeError("kiteconnect package is not installed")
        kite = KiteConnect(api_key=self.api_key)
        return kite.login_url()

    def generate_session(self, request_token: str) -> str:
        """Exchange request_token for access_token (call after redirect)."""
        if not KITE_AVAILABLE:
            raise RuntimeError("kiteconnect package is not installed")
        kite = KiteConnect(api_key=self.api_key)
        session = kite.generate_session(request_token, api_secret=self.api_secret)
        access_token = session["access_token"]
        self.connect(access_token)
        return access_token

    def is_connected(self) -> bool:
        return self._connected and self._kite is not None

    def get_portfolio_value(self, prices: dict) -> dict:
        """Get current portfolio holdings and P&L."""
        if not self.is_connected():
            return {"error": "Not connected to Kite"}
        try:
            positions = self._kite.positions()
            holdings = self._kite.holdings()
            margins = self._kite.margins()

            total_invested = sum(
                h.get("average_price", 0) * h.get("quantity", 0)
                for h in holdings
            )
            current_value = sum(
                h.get("last_price", 0) * h.get("quantity", 0)
                for h in holdings
            )
            pnl = current_value - total_invested

            return {
                "mode": "broker",
                "broker": "zerodha_kite",
                "cash": margins.get("equity", {}).get("available", {}).get("live_balance", 0),
                "total_invested": total_invested,
                "current_value": current_value,
                "pnl": pnl,
                "pnl_pct": (pnl / total_invested * 100) if total_invested else 0,
                "positions_count": len(positions.get("net", [])),
                "holdings_count": len(holdings),
                "positions": positions.get("net", []),
                "holdings": holdings,
            }
        except Exception as e:
            logger.error(f"Kite portfolio fetch error: {e}")
            return {"error": str(e)}

    def place_order(
        self,
        symbol: str,
        direction: str,
        quantity: int,
        order_type: str = "MARKET",
        price: float = 0.0,
        notes: str = "",
    ) -> dict:
        """Place a real order via Kite Connect."""
        if not self.is_connected():
            return {"error": "Not connected to Kite"}

        try:
            # Remove .NS suffix for Kite (uses NSE:SYMBOL format)
            kite_symbol = symbol.replace(".NS", "").replace(".BSE", "")
            exchange = "NSE"

            transaction_type = (
                KiteConnect.TRANSACTION_TYPE_BUY
                if direction.upper() == "BUY"
                else KiteConnect.TRANSACTION_TYPE_SELL
            )

            order_id = self._kite.place_order(
                variety=KiteConnect.VARIETY_REGULAR,
                exchange=exchange,
                tradingsymbol=kite_symbol,
                transaction_type=transaction_type,
                quantity=quantity,
                product=KiteConnect.PRODUCT_CNC,
                order_type=KiteConnect.ORDER_TYPE_MARKET if order_type == "MARKET" else KiteConnect.ORDER_TYPE_LIMIT,
                price=price if order_type == "LIMIT" else None,
            )

            logger.info(f"Kite order placed: {order_id} | {direction} {quantity} {symbol}")
            return {
                "order_id": order_id,
                "symbol": symbol,
                "direction": direction,
                "quantity": quantity,
                "status": "PLACED",
                "broker": "zerodha_kite",
                "timestamp": datetime.utcnow().isoformat(),
                "notes": notes,
            }
        except Exception as e:
            logger.error(f"Kite order placement error: {e}")
            return {"error": str(e)}

    def get_order_history(self, limit: int = 50) -> list:
        """Fetch recent orders from Kite."""
        if not self.is_connected():
            return []
        try:
            orders = self._kite.orders()
            return orders[:limit]
        except Exception as e:
            logger.error(f"Kite order history error: {e}")
            return []

    def get_profile(self) -> dict:
        """Get Kite user profile."""
        if not self.is_connected():
            return {}
        try:
            return self._kite.profile()
        except Exception as e:
            return {"error": str(e)}


# Singleton instance (credentials loaded from env at runtime)
kite_broker = KiteBroker(api_key="", api_secret="")
