"""
Strategy 2: Pullback to EMA (Mean Reversion)
=============================================
Buy when price pulls back to the 20 EMA within an established uptrend.
This is a high-probability setup used extensively by professional swing traders.

Entry Conditions (BUY):
  - Price above 200 EMA (primary uptrend)
  - 20 EMA trending above 50 EMA
  - Price touches or dips slightly below 20 EMA (within 0.5× ATR)
  - RSI between 40 and 55 (not oversold, not overbought)
  - Volume on pullback is declining (drying up = healthy pullback)

Stop Loss: Just below the recent swing low or 1.5× ATR below entry
Target:    Recent high or 2.5× ATR above entry
"""
import pandas as pd
from typing import Optional
from .base import BaseStrategy, SignalResult
import logging

logger = logging.getLogger(__name__)


class PullbackToEMA(BaseStrategy):
    name = "PULLBACK_EMA"
    description = "Pullback to EMA Mean Reversion"

    def __init__(
        self,
        ema_pullback: int = 20,
        ema_trend: int = 200,
        atr_touch_tolerance: float = 0.5,
        rsi_min: float = 38.0,
        rsi_max: float = 58.0,
        atr_sl_mult: float = 1.5,
        atr_tp_mult: float = 2.5,
    ):
        self.ema_pullback = ema_pullback
        self.ema_trend = ema_trend
        self.atr_touch_tolerance = atr_touch_tolerance
        self.rsi_min = rsi_min
        self.rsi_max = rsi_max
        self.atr_sl_mult = atr_sl_mult
        self.atr_tp_mult = atr_tp_mult

    def generate_signal(self, symbol: str, df: pd.DataFrame) -> Optional[SignalResult]:
        if len(df) < 210:
            return None

        row     = df.iloc[-1]
        prev    = df.iloc[-2]
        prev2   = df.iloc[-3]

        close        = self._safe_float(row.get("Close"))
        low          = self._safe_float(row.get("Low"))
        ema20        = self._safe_float(row.get("ema20"))
        ema50        = self._safe_float(row.get("ema50"))
        ema200       = self._safe_float(row.get("ema200"))
        rsi          = self._safe_float(row.get("rsi"))
        atr          = self._safe_float(row.get("atr"))
        volume       = self._safe_float(row.get("Volume"))
        vol_sma20    = self._safe_float(row.get("volume_sma20", volume))
        vol_ratio    = volume / vol_sma20 if vol_sma20 > 0 else 1.0

        # Recent swing lows for stop placement
        recent_low = float(df["Low"].iloc[-10:].min())

        if close == 0 or atr == 0:
            return None

        indicators = {
            "rsi": rsi, "ema20": ema20, "ema50": ema50, "ema200": ema200,
            "atr": atr, "volume_ratio": vol_ratio
        }

        # ─── Primary Trend Filter ─────────────────────────────────────────────
        above_200     = close > ema200
        ema_aligned   = ema20 > ema50 > ema200

        if not above_200 or not ema_aligned:
            return None

        # ─── Pullback touch: price Low within ATR tolerance of EMA20 ──────────
        touch_zone_high = ema20 + self.atr_touch_tolerance * atr
        touch_zone_low  = ema20 - self.atr_touch_tolerance * atr
        price_touched_ema = touch_zone_low <= low <= touch_zone_high or \
                            touch_zone_low <= close <= touch_zone_high

        # ─── RSI in healthy pullback zone ─────────────────────────────────────
        rsi_valid = self.rsi_min <= rsi <= self.rsi_max

        # ─── Volume drying up on pullback (confirmatory) ───────────────────────
        vol_declining = vol_ratio <= 0.85  # volume below average

        # ─── Bullish reversal candle ───────────────────────────────────────────
        is_bullish_close = close > self._safe_float(row.get("Open"))

        if price_touched_ema and rsi_valid and is_bullish_close:
            strength = self._calc_strength(rsi, ema_aligned, vol_declining, touch_zone_low, low, ema20)
            stop_loss = round(min(recent_low - 0.5 * atr, close - self.atr_sl_mult * atr), 2)
            target    = round(close * 1.03, 2) # Strict 3% profit target

            reasoning = (
                f"Price pulled back to 20-EMA (${ema20:.2f}), touching at ${low:.2f}. "
                f"Uptrend intact: EMA20 > EMA50 > EMA200. "
                f"RSI={rsi:.1f} (healthy pullback). "
                f"Volume ratio={vol_ratio:.2f} ({'declining' if vol_declining else 'normal'}). "
                f"Bullish close at ${close:.2f} confirms entry."
            )

            return SignalResult(
                symbol=symbol, strategy=self.name,
                signal="BUY", strength=strength, price=close,
                stop_loss=stop_loss, target=target,
                reasoning=reasoning, indicators=indicators
            )

        return None

    def _calc_strength(self, rsi, ema_aligned, vol_declining, zone_low, low, ema20) -> float:
        score = 50  # base
        score += 20 if ema_aligned else 0
        score += 15 if vol_declining else 0
        # Closer to EMA = stronger signal
        proximity = max(0, 1 - abs(low - ema20) / (ema20 * 0.01)) * 15
        score += proximity
        return min(100, round(score, 1))
