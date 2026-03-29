"""
Technical Indicators
====================
All indicators needed for swing trading strategies.
Uses the 'ta' library + custom Pandas implementations.
"""
import pandas as pd
import numpy as np
import ta
from ta.trend import EMAIndicator, MACD, ADXIndicator
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.volatility import BollingerBands, AverageTrueRange
from ta.volume import VolumeWeightedAveragePrice
import logging

logger = logging.getLogger(__name__)


def add_all_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add all technical indicators to an OHLCV DataFrame.
    Returns the same DataFrame with extra columns.
    """
    if df.empty or len(df) < 30:
        return df

    df = df.copy()

    try:
        # ─── EMAs ────────────────────────────────────────────────────────────
        df["ema9"]   = EMAIndicator(df["Close"], window=9).ema_indicator()
        df["ema20"]  = EMAIndicator(df["Close"], window=20).ema_indicator()
        df["ema50"]  = EMAIndicator(df["Close"], window=50).ema_indicator()
        df["ema200"] = EMAIndicator(df["Close"], window=200).ema_indicator()

        # ─── RSI ─────────────────────────────────────────────────────────────
        df["rsi"] = RSIIndicator(df["Close"], window=14).rsi()

        # ─── MACD ────────────────────────────────────────────────────────────
        macd_obj = MACD(df["Close"], window_slow=26, window_fast=12, window_sign=9)
        df["macd"]        = macd_obj.macd()
        df["macd_signal"] = macd_obj.macd_signal()
        df["macd_hist"]   = macd_obj.macd_diff()

        # ─── Bollinger Bands ─────────────────────────────────────────────────
        bb = BollingerBands(df["Close"], window=20, window_dev=2)
        df["bb_upper"]  = bb.bollinger_hband()
        df["bb_lower"]  = bb.bollinger_lband()
        df["bb_middle"] = bb.bollinger_mavg()
        df["bb_width"]  = bb.bollinger_wband()  # normalized band width
        df["bb_pct"]    = bb.bollinger_pband()  # % position within bands

        # ─── ATR ─────────────────────────────────────────────────────────────
        df["atr"] = AverageTrueRange(df["High"], df["Low"], df["Close"], window=14).average_true_range()

        # ─── ADX ─────────────────────────────────────────────────────────────
        adx = ADXIndicator(df["High"], df["Low"], df["Close"], window=14)
        df["adx"]    = adx.adx()
        df["adx_di_pos"] = adx.adx_pos()
        df["adx_di_neg"] = adx.adx_neg()

        # ─── Stochastic ──────────────────────────────────────────────────────
        stoch = StochasticOscillator(df["High"], df["Low"], df["Close"], window=14, smooth_window=3)
        df["stoch_k"] = stoch.stoch()
        df["stoch_d"] = stoch.stoch_signal()

        # ─── VWAP ────────────────────────────────────────────────────────────
        # VWAP requires intraday data for strict calculation; for daily we approximate
        df["vwap"] = (df["Volume"] * (df["High"] + df["Low"] + df["Close"]) / 3).cumsum() / df["Volume"].cumsum()

        # ─── Volume analysis ─────────────────────────────────────────────────
        df["volume_sma20"]   = df["Volume"].rolling(window=20).mean()
        df["volume_ratio"]   = df["Volume"] / df["volume_sma20"]  # >1.5 = volume spike

        # ─── Candlestick patterns ─────────────────────────────────────────────
        df["body_size"]    = abs(df["Close"] - df["Open"])
        df["upper_shadow"] = df["High"] - df[["Open", "Close"]].max(axis=1)
        df["lower_shadow"] = df[["Open", "Close"]].min(axis=1) - df["Low"]
        df["is_bullish"]   = df["Close"] > df["Open"]
        df["is_doji"]      = df["body_size"] < (df["atr"] * 0.1)

        # ─── Trend helpers ────────────────────────────────────────────────────
        df["above_ema20"]  = df["Close"] > df["ema20"]
        df["above_ema200"] = df["Close"] > df["ema200"]
        df["in_uptrend"]   = (df["ema20"] > df["ema50"]) & (df["ema50"] > df["ema200"])
        df["macd_bullish"] = df["macd"] > df["macd_signal"]

        # ─── MACD crossover ───────────────────────────────────────────────────
        df["macd_cross_up"]   = (df["macd"] > df["macd_signal"]) & (df["macd"].shift(1) <= df["macd_signal"].shift(1))
        df["macd_cross_down"] = (df["macd"] < df["macd_signal"]) & (df["macd"].shift(1) >= df["macd_signal"].shift(1))

    except Exception as e:
        logger.error(f"Error adding indicators: {e}")

    return df


def get_indicator_snapshot(df: pd.DataFrame) -> dict:
    """Return the latest row of key indicators as a dict."""
    if df.empty:
        return {}
    row = df.iloc[-1]
    return {
        "rsi":          round(float(row.get("rsi", 0)), 2),
        "macd":         round(float(row.get("macd", 0)), 4),
        "macd_signal":  round(float(row.get("macd_signal", 0)), 4),
        "macd_hist":    round(float(row.get("macd_hist", 0)), 4),
        "ema9":         round(float(row.get("ema9", 0)), 2),
        "ema20":        round(float(row.get("ema20", 0)), 2),
        "ema50":        round(float(row.get("ema50", 0)), 2),
        "ema200":       round(float(row.get("ema200", 0)), 2),
        "bb_upper":     round(float(row.get("bb_upper", 0)), 2),
        "bb_lower":     round(float(row.get("bb_lower", 0)), 2),
        "bb_width":     round(float(row.get("bb_width", 0)), 4),
        "atr":          round(float(row.get("atr", 0)), 2),
        "adx":          round(float(row.get("adx", 0)), 2),
        "volume_ratio": round(float(row.get("volume_ratio", 0)), 2),
        "in_uptrend":   bool(row.get("in_uptrend", False)),
        "macd_bullish": bool(row.get("macd_bullish", False)),
        "above_ema200": bool(row.get("above_ema200", False)),
    }
