"""
Strategy 3: Bollinger Band Squeeze Breakout
===========================================
Captures volatility expansion after a period of low volatility (squeeze).

Entry Conditions (BUY):
  - Bollinger Band width in the bottom 20th percentile of recent 100 bars (squeeze)
  - Price breaks and closes above the upper Bollinger Band
  - Volume is above average (1.3× volume SMA20)
  - RSI > 50 (momentum supporting the upside)
  - Price above 50 EMA (intermediate trend support)

Exit:
  - First target: 2× band width above upper band
  - Stop loss: Previous close below middle band (20 SMA)

Strategy 4: VWAP Deviation Mean Reversion
==========================================
When price deviates significantly below VWAP, it tends to mean-revert.

Entry Conditions (BUY):
  - Price deviates > 1.5× ATR below VWAP
  - RSI < 35 (oversold)
  - Lowest RSI reading in recent 5 bars (momentum exhausted)
  - Not in a clear downtrend (price still above 200 EMA)

Exit:
  - Target: VWAP level
  - Stop: 1× ATR below current price
"""
import pandas as pd
import numpy as np
from typing import Optional
from .base import BaseStrategy, SignalResult
import logging

logger = logging.getLogger(__name__)


class BollingerSqueeze(BaseStrategy):
    name = "BB_SQUEEZE"
    description = "Bollinger Band Squeeze Breakout"

    def __init__(
        self,
        squeeze_percentile: float = 20.0,
        volume_mult: float = 1.3,
        rsi_min: float = 50.0,
        atr_sl_mult: float = 1.5,
    ):
        self.squeeze_percentile = squeeze_percentile
        self.volume_mult = volume_mult
        self.rsi_min = rsi_min
        self.atr_sl_mult = atr_sl_mult

    def generate_signal(self, symbol: str, df: pd.DataFrame) -> Optional[SignalResult]:
        if len(df) < 110:
            return None

        row   = df.iloc[-1]
        prev  = df.iloc[-2]

        close      = self._safe_float(row.get("Close"))
        bb_upper   = self._safe_float(row.get("bb_upper"))
        bb_middle  = self._safe_float(row.get("bb_middle"))
        bb_lower   = self._safe_float(row.get("bb_lower"))
        bb_width   = self._safe_float(row.get("bb_width"))
        rsi        = self._safe_float(row.get("rsi"))
        ema50      = self._safe_float(row.get("ema50"))
        atr        = self._safe_float(row.get("atr"))
        volume     = self._safe_float(row.get("Volume"))
        vol_sma20  = self._safe_float(row.get("volume_sma20", volume))
        vol_ratio  = volume / vol_sma20 if vol_sma20 > 0 else 1.0

        if close == 0 or atr == 0 or bb_upper == 0:
            return None

        # Squeeze detection: width in bottom percentile of last 100 bars
        recent_widths = df["bb_width"].iloc[-100:].dropna()
        squeeze_threshold = float(np.percentile(recent_widths, self.squeeze_percentile))
        in_squeeze = bb_width <= squeeze_threshold

        # Previous bar was in squeeze but current bar breaks out above upper band
        prev_width = self._safe_float(prev.get("bb_width"))
        prev_close = self._safe_float(prev.get("Close"))
        prev_upper = self._safe_float(prev.get("bb_upper"))

        was_in_squeeze   = prev_width <= squeeze_threshold
        breakout_now     = close > bb_upper
        volume_confirms  = vol_ratio >= self.volume_mult
        rsi_supports     = rsi >= self.rsi_min
        above_ema50      = close > ema50

        indicators = {
            "rsi": rsi, "bb_upper": bb_upper, "bb_middle": bb_middle,
            "bb_width": bb_width, "squeeze_threshold": squeeze_threshold,
            "volume_ratio": vol_ratio, "ema50": ema50, "atr": atr
        }

        if was_in_squeeze and breakout_now and volume_confirms and rsi_supports and above_ema50:
            band_range = bb_upper - bb_lower
            target     = round(bb_upper + band_range, 2)
            stop_loss  = round(close - self.atr_sl_mult * atr, 2)
            strength   = self._calc_strength(vol_ratio, rsi, squeeze_threshold, bb_width)

            reasoning = (
                f"Bollinger Band squeeze breakout on {symbol}. "
                f"BB width {bb_width:.4f} was in squeeze (threshold {squeeze_threshold:.4f}). "
                f"Price broke above upper band (${bb_upper:.2f}) at ${close:.2f}. "
                f"Volume spike: {vol_ratio:.1f}× average. RSI={rsi:.1f}."
            )

            return SignalResult(
                symbol=symbol, strategy=self.name,
                signal="BUY", strength=strength, price=close,
                stop_loss=stop_loss, target=target,
                reasoning=reasoning, indicators=indicators
            )

        return None

    def _calc_strength(self, vol_ratio, rsi, threshold, width) -> float:
        score = 40
        score += min(30, (vol_ratio - 1) * 20)  # volume boost
        score += min(20, (rsi - 50) * 0.8)      # RSI boost
        # How tight was the squeeze?
        squeeze_tightness = max(0, 1 - width / threshold) * 15 if threshold > 0 else 0
        score += squeeze_tightness
        return min(100, round(score, 1))


class VWAPDeviation(BaseStrategy):
    name = "VWAP_DEV"
    description = "VWAP Deviation Mean Reversion"

    def __init__(
        self,
        atr_deviation: float = 1.5,
        rsi_oversold: float = 35.0,
        atr_sl_mult: float = 1.0,
    ):
        self.atr_deviation = atr_deviation
        self.rsi_oversold = rsi_oversold
        self.atr_sl_mult = atr_sl_mult

    def generate_signal(self, symbol: str, df: pd.DataFrame) -> Optional[SignalResult]:
        if len(df) < 30:
            return None

        row    = df.iloc[-1]
        close  = self._safe_float(row.get("Close"))
        vwap   = self._safe_float(row.get("vwap"))
        rsi    = self._safe_float(row.get("rsi"))
        atr    = self._safe_float(row.get("atr"))
        ema200 = self._safe_float(row.get("ema200"))

        if close == 0 or vwap == 0 or atr == 0:
            return None

        deviation   = vwap - close  # positive = below VWAP
        above_200   = close > ema200

        significantly_below = deviation >= self.atr_deviation * atr
        oversold_rsi        = rsi <= self.rsi_oversold

        # RSI must be at its lowest in last 5 sessions (momentum exhaustion)
        recent_rsi = df["rsi"].iloc[-5:].dropna()
        rsi_exhausted = float(recent_rsi.min()) >= rsi - 1

        indicators = {
            "rsi": rsi, "vwap": vwap, "atr": atr,
            "deviation_atr": round(deviation / atr, 2),
            "above_200ema": above_200
        }

        if significantly_below and oversold_rsi and rsi_exhausted and above_200:
            stop_loss = round(close - self.atr_sl_mult * atr, 2)
            target    = round(vwap, 2)
            strength  = self._calc_strength(deviation, atr, rsi)

            reasoning = (
                f"Price {deviation:.2f} ({deviation/atr:.1f}× ATR) below VWAP (${vwap:.2f}). "
                f"RSI={rsi:.1f} at 5-bar low (momentum exhaustion). "
                f"Mean-reversion target: VWAP ${vwap:.2f}. "
                f"Primary trend intact (above 200-EMA)."
            )

            return SignalResult(
                symbol=symbol, strategy=self.name,
                signal="BUY", strength=strength, price=close,
                stop_loss=stop_loss, target=target,
                reasoning=reasoning, indicators=indicators
            )

        return None

    def _calc_strength(self, deviation, atr, rsi) -> float:
        score = 40
        score += min(30, (deviation / atr - 1) * 20)
        score += min(25, (35 - rsi) * 1.5)
        return min(100, round(score, 1))
