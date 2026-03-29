"""
Base Strategy
=============
Abstract base class that all strategies must implement.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd


@dataclass
class SignalResult:
    symbol: str
    strategy: str
    signal: str          # "BUY" | "SELL" | "HOLD"
    strength: float      # 0–100
    price: float
    stop_loss: float
    target: float
    reasoning: str
    indicators: dict = field(default_factory=dict)
    risk_reward: float = 0.0

    def __post_init__(self):
        if self.price > 0 and self.stop_loss > 0 and self.target > 0:
            risk = abs(self.price - self.stop_loss)
            reward = abs(self.target - self.price)
            self.risk_reward = round(reward / risk, 2) if risk > 0 else 0.0


class BaseStrategy(ABC):
    name: str = "BaseStrategy"
    description: str = ""

    @abstractmethod
    def generate_signal(self, symbol: str, df: pd.DataFrame) -> Optional[SignalResult]:
        """
        Analyse OHLCV + indicator DataFrame and return a SignalResult.
        Return None if no valid signal.
        """
        ...

    def _safe_float(self, val, default: float = 0.0) -> float:
        try:
            v = float(val)
            return v if not (v != v) else default  # NaN check
        except Exception:
            return default
