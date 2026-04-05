"""
NSE Algo Trading — Upstox V2 Broker
=====================================
Real money trading via Upstox API v2.
Implements the same interface as paper_broker.py.

Setup:
  pip install upstox-python-sdk
  Set env vars: UPSTOX_API_KEY, UPSTOX_API_SECRET, UPSTOX_REDIRECT_URI
"""
import logging
import requests
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

UPSTOX_BASE = "https://api.upstox.com/v2"


class UpstoxBroker:
    """
    Upstox V2 broker adapter.
    Uses direct REST calls (no SDK dependency required).
    """

    def __init__(self, api_key: str, api_secret: str, redirect_uri: str = "http://localhost:3000/api/broker/upstox/callback"):
        self.api_key = api_key
        self.api_secret = api_secret
        self.redirect_uri = redirect_uri
        self.access_token: Optional[str] = None
        self._connected = False

    def get_login_url(self) -> str:
        """Return OAuth2 authorization URL."""
        return (
            f"https://api.upstox.com/v2/login/authorization/dialog"
            f"?response_type=code&client_id={self.api_key}&redirect_uri={self.redirect_uri}"
        )

    def generate_session(self, code: str) -> str:
        """Exchange auth code for access_token."""
        resp = requests.post(
            f"{UPSTOX_BASE}/login/authorization/token",
            data={
                "code": code,
                "client_id": self.api_key,
                "client_secret": self.api_secret,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        resp.raise_for_status()
        token_data = resp.json()
        self.access_token = token_data.get("access_token")
        self._connected = True
        logger.info("Upstox broker connected successfully")
        return self.access_token

    def connect(self, access_token: str) -> bool:
        self.access_token = access_token
        self._connected = True
        return True

    def is_connected(self) -> bool:
        return self._connected and bool(self.access_token)

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/json",
        }

    def get_portfolio_value(self, prices: dict) -> dict:
        if not self.is_connected():
            return {"error": "Not connected to Upstox"}
        try:
            holdings_resp = requests.get(f"{UPSTOX_BASE}/portfolio/long-term-holdings", headers=self._headers(), timeout=10)
            positions_resp = requests.get(f"{UPSTOX_BASE}/portfolio/short-term-positions", headers=self._headers(), timeout=10)
            funds_resp = requests.get(f"{UPSTOX_BASE}/user/get-funds-and-margin", headers=self._headers(), timeout=10)

            holdings = holdings_resp.json().get("data", []) if holdings_resp.ok else []
            positions = positions_resp.json().get("data", []) if positions_resp.ok else []
            funds = funds_resp.json().get("data", {}) if funds_resp.ok else {}

            total_invested = sum(h.get("average_price", 0) * h.get("quantity", 0) for h in holdings)
            current_value = sum(h.get("last_price", 0) * h.get("quantity", 0) for h in holdings)
            pnl = current_value - total_invested
            cash = funds.get("equity", {}).get("available_margin", 0)

            return {
                "mode": "broker",
                "broker": "upstox",
                "cash": cash,
                "total_invested": total_invested,
                "current_value": current_value,
                "pnl": pnl,
                "pnl_pct": (pnl / total_invested * 100) if total_invested else 0,
                "positions_count": len(positions),
                "holdings_count": len(holdings),
                "holdings": holdings,
                "positions": positions,
            }
        except Exception as e:
            logger.error(f"Upstox portfolio error: {e}")
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
        if not self.is_connected():
            return {"error": "Not connected to Upstox"}
        try:
            # Convert RELIANCE.NS → NSE_EQ|INE002A01018 format requires ISIN lookup
            # For simplicity, we use the instrument key format
            isin_symbol = symbol.replace(".NS", "").replace(".BSE", "")

            payload = {
                "quantity": quantity,
                "product": "D",  # Delivery
                "validity": "DAY",
                "price": price if order_type == "LIMIT" else 0,
                "tag": "trademind_ai",
                "instrument_token": f"NSE_EQ|{isin_symbol}",
                "order_type": order_type,
                "transaction_type": direction.upper(),
                "disclosed_quantity": 0,
                "trigger_price": 0,
                "is_amo": False,
            }

            resp = requests.post(
                f"{UPSTOX_BASE}/order/place",
                json=payload,
                headers={**self._headers(), "Content-Type": "application/json"},
                timeout=10,
            )
            data = resp.json()
            if not resp.ok:
                return {"error": data.get("message", "Order failed")}

            order_id = data.get("data", {}).get("order_id", "")
            logger.info(f"Upstox order placed: {order_id} | {direction} {quantity} {symbol}")
            return {
                "order_id": order_id,
                "symbol": symbol,
                "direction": direction,
                "quantity": quantity,
                "status": "PLACED",
                "broker": "upstox",
                "timestamp": datetime.utcnow().isoformat(),
                "notes": notes,
            }
        except Exception as e:
            logger.error(f"Upstox order error: {e}")
            return {"error": str(e)}

    def get_order_history(self, limit: int = 50) -> list:
        if not self.is_connected():
            return []
        try:
            resp = requests.get(f"{UPSTOX_BASE}/order/history", headers=self._headers(), timeout=10)
            orders = resp.json().get("data", []) if resp.ok else []
            return orders[:limit]
        except Exception as e:
            logger.error(f"Upstox order history error: {e}")
            return []

    def get_profile(self) -> dict:
        if not self.is_connected():
            return {}
        try:
            resp = requests.get(f"{UPSTOX_BASE}/user/profile", headers=self._headers(), timeout=10)
            return resp.json().get("data", {}) if resp.ok else {}
        except Exception as e:
            return {"error": str(e)}


upstox_broker = UpstoxBroker(api_key="", api_secret="")
