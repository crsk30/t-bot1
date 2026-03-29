"""
Backtesting Runner
==================
Uses the 'backtesting.py' framework to evaluate strategies on historical data.
Returns performance metrics: total return, Sharpe, max drawdown, win rate.
"""
import pandas as pd
import numpy as np
from backtesting import Backtest, Strategy
from backtesting.lib import crossover
import ta
import logging

logger = logging.getLogger(__name__)


def _add_indicators_sync(df: pd.DataFrame) -> pd.DataFrame:
    """Add indicators synchronously for backtesting."""
    from ta.trend import EMAIndicator, MACD
    from ta.momentum import RSIIndicator
    from ta.volatility import AverageTrueRange, BollingerBands

    df = df.copy()
    df["ema20"]       = EMAIndicator(df["Close"], window=20).ema_indicator()
    df["ema50"]       = EMAIndicator(df["Close"], window=50).ema_indicator()
    df["ema200"]      = EMAIndicator(df["Close"], window=200).ema_indicator()
    df["rsi"]         = RSIIndicator(df["Close"], window=14).rsi()
    macd              = MACD(df["Close"])
    df["macd"]        = macd.macd()
    df["macd_signal"] = macd.macd_signal()
    df["atr"]         = AverageTrueRange(df["High"], df["Low"], df["Close"], window=14).average_true_range()
    bb                = BollingerBands(df["Close"], window=20, window_dev=2)
    df["bb_upper"]    = bb.bollinger_hband()
    df["bb_lower"]    = bb.bollinger_lband()
    df["bb_width"]    = bb.bollinger_wband()
    df.dropna(inplace=True)
    return df


# ─── Strategy 1: EMA RSI for backtesting ──────────────────────────────────────
class EMARSIBacktest(Strategy):
    atr_sl  = 2.0
    atr_tp  = 3.0
    rsi_buy = 50
    rsi_sell= 70

    def init(self):
        self.ema20  = self.I(lambda x: x, self.data.ema20)
        self.ema50  = self.I(lambda x: x, self.data.ema50)
        self.ema200 = self.I(lambda x: x, self.data.ema200)
        self.rsi    = self.I(lambda x: x, self.data.rsi)
        self.macd   = self.I(lambda x: x, self.data.macd)
        self.msig   = self.I(lambda x: x, self.data.macd_signal)
        self.atr    = self.I(lambda x: x, self.data.atr)

    def next(self):
        price  = self.data.Close[-1]
        rsi    = self.rsi[-1]
        atr    = self.atr[-1]

        if not self.position:
            # Entry
            above_trend   = price > self.ema200[-1]
            ema_aligned   = self.ema20[-1] > self.ema50[-1]
            rsi_pullback  = 25 <= rsi <= self.rsi_buy
            macd_cross_up = crossover(self.macd, self.msig)

            if above_trend and ema_aligned and rsi_pullback and macd_cross_up:
                sl = price - self.atr_sl * atr
                tp = price + self.atr_tp * atr
                self.buy(sl=sl, tp=tp)
        else:
            # Exit
            if rsi > self.rsi_sell or crossover(self.msig, self.macd):
                self.position.close()


# ─── Strategy 2: Bollinger Band Squeeze ──────────────────────────────────────
class BBSqueezeBacktest(Strategy):
    vol_mult = 1.3
    atr_sl   = 1.5

    def init(self):
        self.ema50   = self.I(lambda x: x, self.data.ema50)
        self.rsi     = self.I(lambda x: x, self.data.rsi)
        self.bb_up   = self.I(lambda x: x, self.data.bb_upper)
        self.bb_lo   = self.I(lambda x: x, self.data.bb_lower)
        self.bb_w    = self.I(lambda x: x, self.data.bb_width)
        self.atr     = self.I(lambda x: x, self.data.atr)

    def next(self):
        if len(self.bb_w) < 20:
            return
        price   = self.data.Close[-1]
        width   = self.bb_w[-1]
        thresh  = np.percentile(self.bb_w[-100:], 20)
        was_sq  = self.bb_w[-2] <= thresh
        break_u = price > self.bb_up[-1]
        rsi_ok  = self.rsi[-1] >= 50

        if not self.position:
            if was_sq and break_u and rsi_ok:
                sl = price - self.atr_sl * self.atr[-1]
                tp = price + (self.bb_up[-1] - self.bb_lo[-1])
                self.buy(sl=sl, tp=tp)
        else:
            if price < self.data.Close[-5:].mean():
                self.position.close()


def run_backtest(
    symbol: str,
    strategy_name: str,
    start_date: str,
    end_date: str,
    cash: float = 500000,
) -> dict:
    """
    Run a backtest for the given strategy and return performance metrics.
    """
    try:
        import yfinance as yf
        df = yf.download(symbol, start=start_date, end=end_date, auto_adjust=True, progress=False)
        if df.empty or len(df) < 250:
            return {"error": f"Insufficient data for {symbol}"}

        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        df = _add_indicators_sync(df)

        strategy_map = {
            "EMA_RSI_MACD": EMARSIBacktest,
            "BB_SQUEEZE":   BBSqueezeBacktest,
        }

        if strategy_name not in strategy_map:
            return {"error": f"Unknown strategy: {strategy_name}"}

        bt = Backtest(
            df,
            strategy_map[strategy_name],
            cash=cash,
            commission=settings.paper_brokerage_pct * 2,  # round-trip
            exclusive_orders=True
        )

        stats = bt.run()

        return {
            "symbol":           symbol,
            "strategy":         strategy_name,
            "start":            start_date,
            "end":              end_date,
            "cash":             cash,
            "final_value":      round(float(stats["Equity Final [$]"]), 2),
            "return_pct":       round(float(stats["Return [%]"]), 2),
            "buy_hold_pct":     round(float(stats["Buy & Hold Return [%]"]), 2),
            "max_drawdown_pct": round(float(stats["Max. Drawdown [%]"]), 2),
            "sharpe":           round(float(stats["Sharpe Ratio"]), 3),
            "win_rate":         round(float(stats["Win Rate [%]"]), 2),
            "profit_factor":    round(float(stats.get("Profit Factor", 0)), 3),
            "num_trades":       int(stats["# Trades"]),
            "avg_trade_pct":    round(float(stats["Avg. Trade [%]"]), 2),
            "best_trade_pct":   round(float(stats["Best Trade [%]"]), 2),
            "worst_trade_pct":  round(float(stats["Worst Trade [%]"]), 2),
        }

    except Exception as e:
        logger.error(f"Backtest error: {e}")
        return {"error": str(e)}
