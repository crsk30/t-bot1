"""
NSE Algo Trading - Configuration
================================
All settings loaded from environment variables with sensible defaults.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    # App
    app_name: str = "NSE Algo Trading Engine"
    debug: bool = False
    host: str = "0.0.0.0"
    port: int = 8000

    # Broker (defaults to paper trading)
    broker: str = "paper"  # paper | kite | upstox | angel
    kite_api_key: str = ""
    kite_api_secret: str = ""
    upstox_api_key: str = ""
    upstox_api_secret: str = ""
    angel_api_key: str = ""
    angel_client_id: str = ""
    angel_mpin: str = ""
    angel_totp_secret: str = ""

    # Paper trading
    paper_capital: float = 200000.0  # ₹2 Lakhs
    paper_brokerage_pct: float = 0.0003  # 0.03% per leg

    # Risk management
    max_position_pct: float = 0.03       # 3% of capital per trade
    max_portfolio_risk_pct: float = 0.20  # 20% max deployed
    atr_stop_multiplier: float = 2.0
    min_risk_reward: float = 0.0

    # Strategy engine
    scan_interval_seconds: int = 300  # Scan every 5 minutes
    watchlist: List[str] = [
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "ICICIBANK.NS", "BHARTIARTL.NS", 
        "SBIN.NS", "INFY.NS", "ITC.NS", "HINDUNILVR.NS", "LT.NS", "BAJFINANCE.NS", 
        "HCLTECH.NS", "MARUTI.NS", "SUNPHARMA.NS", "TATAMOTORS.NS", "KOTAKBANK.NS", 
        "M&M.NS", "AXISBANK.NS", "ASIANPAINT.NS", "TATASTEEL.NS", "TITAN.NS", 
        "ULTRACEMCO.NS", "BAJAJFINSV.NS", "WIPRO.NS", "NESTLEIND.NS", "ONGC.NS", 
        "POWERGRID.NS", "NTPC.NS", "JSWSTEEL.NS", "ADANIENT.NS", "ADANIPORTS.NS", 
        "HINDALCO.NS", "GRASIM.NS", "TECHM.NS", "CIPLA.NS", "APOLLOHOSP.NS", 
        "TATACONSUM.NS", "EICHERMOT.NS", "DIVISLAB.NS", "SBILIFE.NS", "DRREDDY.NS", 
        "UPL.NS", "HEROMOTOCO.NS", "BRITANNIA.NS", "INDUSINDBK.NS", "BAJAJ-AUTO.NS", 
        "HDFCLIFE.NS", "BPCL.NS", "COALINDIA.NS", "TRENT.NS"
    ]

    # Database
    database_url: str = "sqlite+aiosqlite:///./algo_trading.db"

    # JWT for Node.js gateway auth
    jwt_secret: str = "change-this-in-production-secret"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
