"""
Strategy 1: EMA Crossover + RSI Confirmation
============================================
Classic swing trading setup combining trend (EMA) and momentum (RSI + MACD).

Entry Conditions (BUY):
  - Price is above the 200-day EMA (primary uptrend confirmed)
  - 20 EMA is above 50 EMA (intermediate uptrend)
  - RSI(14) between 30 and 50 (not overbought, recent pullback)
  - MACD line crosses above Signal line (momentum turning bullish)
  - ADX > 20 (trend is strong enough)

Exit / Sell Conditions:
  - RSI(14) > 70 (overbought)
  - MACD crosses below signal (momentum turning bearish)
  - Price closes below 20 EMA

Stop Loss: 2× ATR below entry
Target:    3× ATR above entry (min 2:1 RR)
"""
import pandas as pd
from typing import Optional
from .base import BaseStrategy, SignalResult
import logging

logger = logging.getLogger(__name__)


class EMACrossoverRSI(BaseStrategy):
    name = "EMA_RSI_MACD"
    description = "EMA Crossover with RSI + MACD Confirmation"

    def __init__(
        self,
        ema_fast: int = 20,
        ema_slow: int = 50,
        ema_trend: int = 200,
        rsi_period: int = 14,
        rsi_oversold: float = 50.0,
        rsi_overbought: float = 70.0,
        adx_threshold: float = 20.0,
        atr_sl_mult: float = 2.0,
        atr_tp_mult: float = 3.0,
    ):
        self.ema_fast = ema_fast
        self.ema_slow = ema_slow
        self.ema_trend = ema_trend
        self.rsi_oversold = rsi_oversold
        self.rsi_overbought = rsi_overbought
        self.adx_threshold = adx_threshold
        self.atr_sl_mult = atr_sl_mult
        self.atr_tp_mult = atr_tp_mult

    def generate_signal(self, symbol: str, df: pd.DataFrame) -> Optional[SignalResult]:
        if len(df) < 210:
            return None

        row = df.iloc[-1]
        prev = df.iloc[-2]

        rsi        = self._safe_float(row.get("rsi"))
        macd       = self._safe_float(row.get("macd"))
        macd_sig   = self._safe_float(row.get("macd_signal"))
        prev_macd  = self._safe_float(prev.get("macd"))
        prev_msig  = self._safe_float(prev.get("macd_signal"))
        ema20      = self._safe_float(row.get("ema20"))
        ema50      = self._safe_float(row.get("ema50"))
        ema200     = self._safe_float(row.get("ema200"))
        adx        = self._safe_float(row.get("adx"))
        atr        = self._safe_float(row.get("atr"))
        close      = self._safe_float(row.get("Close"))

        if close == 0 or atr == 0:
            return None

        indicators = {
            "rsi": rsi, "macd": macd, "macd_signal": macd_sig,
            "ema20": ema20, "ema50": ema50, "ema200": ema200,
            "adx": adx, "atr": atr
        }

        # ─── BUY Signal ───────────────────────────────────────────────────────
        above_trend     = close > ema200
        ema_aligned     = ema20 > ema50
        rsi_in_zone     = 25 <= rsi <= self.rsi_oversold
        macd_cross_up   = (macd > macd_sig) and (prev_macd <= prev_msig)
        trend_strong    = adx >= self.adx_threshold

        if above_trend and ema_aligned and rsi_in_zone and macd_cross_up and trend_strong:
            stop_loss = round(close - self.atr_sl_mult * atr, 2)
            target    = round(close * 1.03, 2) # Strict 3% profit target
            strength  = self._calc_strength(rsi, adx, above_trend, ema_aligned)

            reasoning = (
                f"Price ${close:.2f} above 200-EMA (${ema200:.2f}). "
                f"20-EMA above 50-EMA (aligned uptrend). "
                f"RSI={rsi:.1f} (pullback zone). "
                f"MACD crossed UP. ADX={adx:.1f} (strong trend)."
            )

            return SignalResult(
                symbol=symbol, strategy=self.name,
                signal="BUY", strength=strength, price=close,
                stop_loss=stop_loss, target=target,
                reasoning=reasoning, indicators=indicators
            )

        return None

    def _calc_strength(self, rsi: float, adx: float, above_trend: bool, ema_aligned: bool) -> float:
        score = 0
        # RSI lower = stronger pullback = stronger entry
        score += max(0, (50 - rsi) * 1.5)  # max ~37.5
        score += min(30, adx)               # max 30
        score += 15 if above_trend else 0
        score += 15 if ema_aligned else 0
        return min(100, round(score, 1))
