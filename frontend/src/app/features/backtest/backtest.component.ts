import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, BacktestResult } from '../../core/api.service';

@Component({
  selector: 'app-backtest',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>🔬 Strategy Backtester</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
            Test algorithms on historical data
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 2rem;">
        <div class="grid-4" style="align-items: end; gap: 1.5rem;">
          <div>
            <label class="text-muted" style="font-size: 0.8rem; display: block; margin-bottom: 0.3rem;">Symbol</label>
            <input type="text" class="input" [(ngModel)]="btSymbol" placeholder="e.g. RELIANCE.NS">
          </div>
          <div>
            <label class="text-muted" style="font-size: 0.8rem; display: block; margin-bottom: 0.3rem;">Strategy</label>
            <select class="input" [(ngModel)]="btStrategy">
              <option value="EMA_RSI_MACD">EMA + RSI + MACD</option>
              <option value="BB_SQUEEZE">BB Squeeze</option>
            </select>
          </div>
          <div>
            <label class="text-muted" style="font-size: 0.8rem; display: block; margin-bottom: 0.3rem;">Start Date</label>
            <input type="date" class="input" [(ngModel)]="btStart">
          </div>
          <div>
            <button class="btn btn-primary w-100" style="padding: 0.6rem; justify-content: center;" (click)="runBacktest()" [disabled]="running()">
              {{ running() ? '⏳ Running...' : '▶ Run Backtest' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Results Loading -->
      <div *ngIf="running()" style="text-align: center; padding: 4rem; color: var(--text-muted);">
        <div class="spinner" style="margin: 0 auto 1rem;"></div>
        Simulating 1-minute OHLC data and executing trades...
      </div>

      <!-- Error -->
      <div *ngIf="error()" class="card" style="border-color: var(--bear); color: var(--bear);">
        ⚠ {{ error() }}
      </div>

      <!-- Results -->
      <div *ngIf="result() && !running()" class="card">
        <h2 style="margin-bottom: 1.5rem;" class="flex items-center gap-2">
            📊 Results: {{ result()!.symbol.replace('.NS','') }}
            <span class="badge badge-open">{{ result()!.strategy }}</span>
        </h2>
        
        <div class="grid-4">
          <!-- Return vs Buy & Hold -->
          <div class="card kpi-card" style="background: var(--bg-surface);">
            <div class="kpi-label">Strategy Return</div>
            <div class="kpi-value" [class]="result()!.return_pct >= 0 ? 'text-bull' : 'text-bear'">
              {{ result()!.return_pct >= 0 ? '+' : '' }}{{ result()!.return_pct | number:'1.2-2' }}%
            </div>
            <div class="kpi-sub" style="display:flex; justify-content: space-between; align-items: center;">
              <span class="text-muted">Buy & Hold:</span>
              <span [class]="result()!.return_pct > result()!.buy_hold_pct ? 'text-bull' : ''">
                {{ result()!.buy_hold_pct | number:'1.2-2' }}%
              </span>
            </div>
          </div>

          <!-- Final Equity -->
          <div class="card kpi-card" style="background: var(--bg-surface);">
            <div class="kpi-label">Final Value</div>
            <div class="kpi-value">₹{{ result()!.final_value | number:'1.0-0' }}</div>
            <div class="kpi-sub text-muted">Started with ₹5L</div>
          </div>

          <!-- Win Rate -->
          <div class="card kpi-card" style="background: var(--bg-surface);">
            <div class="kpi-label">Win Rate</div>
            <div class="kpi-value" [class]="result()!.win_rate > 50 ? 'text-bull' : 'text-neutral'">
              {{ result()!.win_rate | number:'1.1-1' }}%
            </div>
            <div class="kpi-sub text-muted">Over {{ result()!.num_trades }} trades</div>
          </div>

          <!-- Risk / Volatility -->
          <div class="card kpi-card" style="background: var(--bg-surface);">
            <div class="kpi-label">Risk Profile</div>
            <div class="kpi-value" [class]="result()!.sharpe > 1 ? 'text-bull' : result()!.sharpe > 0 ? 'text-neutral' : 'text-bear'">
              Sharpe: {{ result()!.sharpe | number:'1.2-2' }}
            </div>
            <div class="kpi-sub text-bear" style="font-weight: 500;">
              Max DD: {{ result()!.max_drawdown_pct | number:'1.1-1' }}%
            </div>
          </div>
        </div>

        <div class="grid-3" style="margin-top: 1rem;">
            <div class="card" style="background: var(--bg-surface); padding: 1rem;">
                <div class="text-muted uppercase" style="font-size: 0.7rem;">Average Trade</div>
                <div class="text-mono" [class]="result()!.avg_trade_pct >= 0 ? 'text-bull' : 'text-bear'" style="font-size: 1.1rem;">
                    {{ result()!.avg_trade_pct | number:'1.2-2' }}%
                </div>
            </div>
            <div class="card" style="background: var(--bg-surface); padding: 1rem;">
                <div class="text-muted uppercase" style="font-size: 0.7rem;">Best Trade</div>
                <div class="text-mono text-bull" style="font-size: 1.1rem;">
                    +{{ result()!.best_trade_pct | number:'1.2-2' }}%
                </div>
            </div>
            <div class="card" style="background: var(--bg-surface); padding: 1rem;">
                <div class="text-muted uppercase" style="font-size: 0.7rem;">Worst Trade</div>
                <div class="text-mono text-bear" style="font-size: 1.1rem;">
                    {{ result()!.worst_trade_pct | number:'1.2-2' }}%
                </div>
            </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .spinner {
        width: 40px; height: 40px;
        border: 4px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .uppercase { text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  `]
})
export class BacktestComponent {
  btSymbol = 'RELIANCE.NS';
  btStrategy = 'EMA_RSI_MACD';
  btStart = '2023-01-01';
  
  running = signal(false);
  result = signal<BacktestResult | null>(null);
  error = signal<string>('');

  constructor(private api: ApiService) {}

  runBacktest() {
      if (!this.btSymbol) return;
      this.running.set(true);
      this.error.set('');
      this.result.set(null);
      
      const endDate = new Date().toISOString().split('T')[0];
      
      this.api.runBacktest(this.btSymbol, this.btStrategy, this.btStart, endDate, 500000).subscribe({
          next: (res) => {
              this.running.set(false);
              this.result.set(res);
          },
          error: (err) => {
              this.running.set(false);
              this.error.set(err.error?.detail || err.message || 'Backtest failed');
          }
      });
  }
}
