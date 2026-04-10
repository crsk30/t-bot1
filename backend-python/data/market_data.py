"""
Market Data Fetcher
===================
Downloads OHLCV data from Yahoo Finance (yfinance) for NSE stocks.
Supports both historical and recent data for strategy analysis.
"""
import yfinance as yf
import pandas as pd
import numpy as np
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class MarketDataService:
    """Fetches and caches OHLCV data for NSE stocks."""

    def __init__(self):
        self._cache: dict[str, pd.DataFrame] = {}

    def get_ohlcv(
        self,
        symbol: str,
        period: str = "1y",
        interval: str = "1d",
        force_refresh: bool = False
    ) -> pd.DataFrame:
        """
        Fetch OHLCV data for an NSE stock.
        Symbol should be like 'RELIANCE.NS' or we auto-append .NS
        """
        symbol = self._normalize_symbol(symbol)
        cache_key = f"{symbol}_{period}_{interval}"

        if not force_refresh and cache_key in self._cache:
            return self._cache[cache_key]

        try:
            logger.info(f"Fetching data for {symbol} period={period} interval={interval}")
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval=interval, auto_adjust=True)

            if df.empty:
                logger.warning(f"No data returned for {symbol}")
                return pd.DataFrame()

            # Clean the dataframe
            df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
            df.index = pd.to_datetime(df.index)
            df.index = df.index.tz_localize(None)  # Remove timezone for simplicity
            df.dropna(inplace=True)
            df.sort_index(inplace=True)

            self._cache[cache_key] = df
            logger.info(f"Got {len(df)} rows for {symbol}")
            return df

        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {e}")
            return pd.DataFrame()

    def get_pe_ratio(self, symbol: str) -> float:
        """Fetch the trailing P/E ratio using yfinance."""
        try:
            sym = self._normalize_symbol(symbol)
            ticker = yf.Ticker(sym)
            pe = ticker.info.get("trailingPE", 0.0)
            return float(pe) if pe is not None else 0.0
        except Exception as e:
            logger.debug(f"Could not fetch P/E for {symbol}: {e}")
            return 0.0

    def get_latest_price(self, symbol: str) -> Optional[float]:
        """Get the most recent closing price."""
        df = self.get_ohlcv(symbol, period="5d", force_refresh=True)
        if df.empty:
            return None
        return float(df["Close"].iloc[-1])

    def get_multiple(self, symbols: list[str], period: str = "1y") -> dict[str, pd.DataFrame]:
        """Fetch data for multiple symbols."""
        results = {}
        for symbol in symbols:
            df = self.get_ohlcv(symbol, period=period)
            if not df.empty:
                results[symbol] = df
        return results

    def get_quote(self, symbol: str) -> dict:
        """Get current quote info for a symbol."""
        symbol = self._normalize_symbol(symbol)
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info
            df = self.get_ohlcv(symbol, period="5d", interval="1d", force_refresh=True)
            last_close = float(df["Close"].iloc[-1]) if not df.empty else 0
            prev_close = float(df["Close"].iloc[-2]) if len(df) >= 2 else last_close
            change = last_close - prev_close
            change_pct = (change / prev_close * 100) if prev_close else 0

            return {
                "symbol": symbol,
                "last_price": last_close,
                "prev_close": prev_close,
                "change": round(change, 2),
                "change_pct": round(change_pct, 2),
                "volume": int(df["Volume"].iloc[-1]) if not df.empty else 0,
                "high": float(df["High"].iloc[-1]) if not df.empty else 0,
                "low": float(df["Low"].iloc[-1]) if not df.empty else 0,
            }
        except Exception as e:
            logger.error(f"Error getting quote for {symbol}: {e}")
            return {"symbol": symbol, "error": str(e)}

    def get_chart_data(self, symbol: str, period: str = "6mo", interval: str = "1d") -> list[dict]:
        """Get OHLCV data formatted for TradingView Lightweight Charts."""
        df = self.get_ohlcv(symbol, period=period, interval=interval)
        if df.empty:
            return []

        result = []
        for ts, row in df.iterrows():
            result.append({
                "time": int(ts.timestamp()),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            })
        return result

    def clear_cache(self):
        self._cache.clear()

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        if not symbol.endswith(".NS") and not symbol.endswith(".BO"):
            return symbol + ".NS"
        return symbol


market_data = MarketDataService()
