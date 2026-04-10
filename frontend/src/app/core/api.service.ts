import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Signal {
  id: string;
  symbol: string;
  strategy: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
  price: number;
  stop_loss: number;
  target: number;
  risk_reward: number;
  pe_ratio?: number;
  reasoning: string;
  indicators: Record<string, number | boolean>;
  timestamp: string;
}

export interface PortfolioPosition {
  symbol: string;
  qty: number;
  avg_price: number;
  cur_price: number;
  cur_value: number;
  pnl: number;
  pnl_pct: number;
}

export interface Portfolio {
  cash: number;
  invested: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  positions: PortfolioPosition[];
}

export interface TraderThought {
  timestamp: string;
  action: string;
  symbol: string;
  reasoning: string;
  decided: boolean;
  details: Record<string, unknown>;
}

export interface Order {
  order_id: string;
  symbol: string;
  direction: string;
  quantity: number;
  filled_price: number;
  status: string;
  brokerage: number;
  timestamp: string;
  notes: string;
}

export interface BacktestResult {
  symbol: string;
  strategy: string;
  return_pct: number;
  buy_hold_pct: number;
  max_drawdown_pct: number;
  sharpe: number;
  win_rate: number;
  num_trades: number;
  avg_trade_pct: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  final_value: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiUrl;

  // Signals state
  signals = signal<Signal[]>([]);
  portfolio = signal<Portfolio | null>(null);
  orders = signal<Order[]>([]);
  engineRunning = signal(false);
  autoTraderActive = signal(false);

  buySignals = computed(() => this.signals().filter(s => s.signal === 'BUY'));
  sellSignals = computed(() => this.signals().filter(s => s.signal === 'SELL'));

  constructor(private http: HttpClient) {}

  // ── Engine ──────────────────────────────────────────────────────────
  getEngineStatus() { return this.http.get<any>(`${this.base}/engine/status`); }
  startEngine()     { return this.http.post<any>(`${this.base}/engine/start`, {}); }
  stopEngine()      { return this.http.post<any>(`${this.base}/engine/stop`, {}); }
  triggerScan()     { return this.http.post<any>(`${this.base}/engine/scan`, {}); }

  // ── AutoTrader ───────────────────────────────────────────────────────
  getAutoTraderStatus() { return this.http.get<any>(`${this.base}/autotrader/status`); }
  startAutoTrader()     { return this.http.post<any>(`${this.base}/autotrader/start`, {}); }
  stopAutoTrader()      { return this.http.post<any>(`${this.base}/autotrader/stop`, {}); }
  getThoughts(limit = 100) { return this.http.get<{thoughts: TraderThought[]}>(`${this.base}/autotrader/thoughts?limit=${limit}`); }

  // ── Signals ──────────────────────────────────────────────────────────
  getSignals() { return this.http.get<{signals: Signal[]}>(`${this.base}/signals`); }
  scanNow()    { return this.http.get<{signals: Signal[]}>(`${this.base}/signals/scan`); }

  // ── Market Data ───────────────────────────────────────────────────────
  getQuote(symbol: string) { return this.http.get<any>(`${this.base}/stocks/${symbol}/quote`); }
  getChart(symbol: string, period = '6mo', interval = '1d') {
    return this.http.get<any>(`${this.base}/stocks/${symbol}/chart?period=${period}&interval=${interval}`);
  }
  getIndicators(symbol: string) { return this.http.get<any>(`${this.base}/stocks/${symbol}/indicators`); }
  getBatchQuotes(symbols: string[]) {
    return this.http.get<any>(`${this.base}/stocks/quotes?symbols=${symbols.join(',')}`);
  }

  // ── Portfolio ─────────────────────────────────────────────────────────
  getPortfolio() { return this.http.get<Portfolio>(`${this.base}/portfolio`); }
  getOrders(limit = 50) { return this.http.get<{orders: Order[]}>(`${this.base}/orders?limit=${limit}`); }

  placeOrder(symbol: string, direction: string, quantity: number, notes = '') {
    return this.http.post<any>(`${this.base}/orders`, { symbol, direction, quantity, notes });
  }

  // ── Watchlist ─────────────────────────────────────────────────────────
  getWatchlist() { return this.http.get<{watchlist: string[]}>(`${this.base}/watchlist`); }
  updateWatchlist(symbols: string[]) {
    return this.http.put<any>(`${this.base}/watchlist`, { symbols });
  }

  // ── Backtest ──────────────────────────────────────────────────────────
  runBacktest(symbol: string, strategy: string, start_date: string, end_date: string, cash = 500000) {
    return this.http.post<BacktestResult>(`${this.base}/backtest`, { symbol, strategy, start_date, end_date, cash });
  }

  // ── Health ────────────────────────────────────────────────────────────
  getHealth() {
    return this.http.get<any>(`${this.base}/health`).pipe(catchError(() => of({ status: 'error' })));
  }
}
