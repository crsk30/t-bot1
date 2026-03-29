import { Component, OnInit, OnDestroy, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { WebSocketService } from '../../core/websocket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <!-- Header -->
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
            NSE Swing Trading · Paper Mode · {{ currentTime() }}
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-ghost" (click)="refreshAll()" [disabled]="loading()">
            {{ loading() ? '⏳' : '🔄' }} Refresh
          </button>
          <button class="btn" [class]="engineOn() ? 'btn-bear' : 'btn-primary'"
                  (click)="toggleEngine()">
            {{ engineOn() ? '⏹ Stop Engine' : '▶ Start Engine' }}
          </button>
          <button class="btn" [class]="traderOn() ? 'btn-bear' : 'btn-bull'"
                  (click)="toggleTrader()">
            {{ traderOn() ? '🛑 Stop AutoTrader' : '🤖 Start AutoTrader' }}
          </button>
        </div>
      </div>

      <!-- Portfolio KPIs -->
      <div class="grid-4" style="margin-bottom:1rem;" *ngIf="portfolio()">
        <div class="card kpi-card">
          <div class="kpi-label">Total Value</div>
          <div class="kpi-value">₹{{ portfolio()!.total_value | number:'1.0-0' }}</div>
          <div class="kpi-sub">
            <span class="stat-pill" [class]="portfolio()!.total_pnl >= 0 ? 'bull' : 'bear'">
              {{ portfolio()!.total_pnl >= 0 ? '▲' : '▼' }}
              {{ portfolio()!.total_pnl_pct | number:'1.2-2' }}%
            </span>
          </div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">Cash Available</div>
          <div class="kpi-value">₹{{ portfolio()!.cash | number:'1.0-0' }}</div>
          <div class="kpi-sub text-muted">Uninvested capital</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">Invested</div>
          <div class="kpi-value">₹{{ portfolio()!.invested | number:'1.0-0' }}</div>
          <div class="kpi-sub text-muted">{{ portfolio()!.positions.length || 0 }} open positions</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label">Total P&amp;L</div>
          <div class="kpi-value" [class]="portfolio()!.total_pnl >= 0 ? 'text-bull' : 'text-bear'">
            {{ portfolio()!.total_pnl >= 0 ? '+' : '' }}₹{{ portfolio()!.total_pnl | number:'1.0-0' }}
          </div>
          <div class="kpi-sub text-muted">Since start</div>
        </div>
      </div>

      <!-- Skeleton if no portfolio -->
      <div class="grid-4" style="margin-bottom:1rem;" *ngIf="!portfolio()">
        <div class="card skeleton" style="height:90px"></div>
        <div class="card skeleton" style="height:90px"></div>
        <div class="card skeleton" style="height:90px"></div>
        <div class="card skeleton" style="height:90px"></div>
      </div>

      <!-- Two columns: signals + activity -->
      <div style="display:grid;grid-template-columns:1fr 380px;gap:1rem;">

        <!-- Latest signals -->
        <div class="card">
          <div class="flex items-center justify-between mb-2">
            <h3>⚡ Latest Signals <span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">({{ totalSignals() }} active)</span></h3>
            <a routerLink="/signals" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;">View All →</a>
          </div>

          <div *ngIf="topSignals().length === 0" class="text-muted" style="padding:2rem;text-align:center;">
            No signals yet. Start the engine to scan markets.
          </div>

          <div *ngFor="let s of topSignals()" class="signal-row" [routerLink]="['/charts', s.symbol]">
            <div class="signal-main">
              <span class="badge" [class]="'badge-' + s.signal.toLowerCase()">{{ s.signal }}</span>
              <span class="signal-symbol">{{ s.symbol.replace('.NS','') }}</span>
              <span class="signal-strategy text-muted">{{ s.strategy }}</span>
            </div>
            <div class="signal-right">
              <div class="text-mono">₹{{ s.price | number:'1.2-2' }}</div>
              <div class="strength-bar" style="width:60px;">
                <div class="strength-fill"
                     [style.width]="s.strength + '%'"
                     [style.background]="s.signal === 'BUY' ? 'var(--bull)' : 'var(--bear)'">
                </div>
              </div>
              <div class="text-muted" style="font-size:0.72rem;">RR {{ s.risk_reward }}:1</div>
            </div>
          </div>
        </div>

        <!-- Right column: trader activity + positions -->
        <div style="display:flex;flex-direction:column;gap:1rem;">

          <!-- AutoTrader status card -->
          <div class="card" [class.accent-border]="traderOn()">
            <div class="flex items-center justify-between mb-2">
              <h3>🧠 AutoTrader</h3>
              <span class="badge" [class]="traderOn() ? 'badge-buy' : 'badge-hold'">
                {{ traderOn() ? 'ACTIVE' : 'IDLE' }}
              </span>
            </div>
            <div *ngIf="latestThought()" class="thought-bubble">
              <div class="thought-icon">{{ latestThought()!.decided ? '✅' : '💭' }}</div>
              <div>
                <div style="font-size:0.78rem;font-weight:500;">{{ latestThought()!.action }}</div>
                <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:2px;line-height:1.4;">
                  {{ latestThought()!.reasoning | slice:0:120 }}...
                </div>
              </div>
            </div>
            <div *ngIf="!latestThought()" class="text-muted" style="font-size:0.8rem;padding:0.5rem 0;">
              Waiting for first scan...
            </div>
            <a routerLink="/trader-log" class="btn btn-ghost" style="width:100%;margin-top:0.75rem;justify-content:center;font-size:0.8rem;">
              View Full Thought Journal →
            </a>
          </div>

          <!-- Open positions -->
          <div class="card">
            <h3 style="margin-bottom:0.75rem;">💼 Open Positions</h3>
            <div *ngIf="!portfolio() || portfolio()!.positions.length === 0" class="text-muted" style="font-size:0.8rem;text-align:center;padding:1rem 0;">
              No open positions
            </div>
            <div *ngFor="let p of portfolio()?.positions" class="position-row">
              <div>
                <div style="font-weight:600;font-size:0.85rem;">{{ p.symbol.replace('.NS','') }}</div>
                <div class="text-muted" style="font-size:0.72rem;">{{ p.qty }} shares @ ₹{{ p.avg_price }}</div>
              </div>
              <div style="text-align:right;">
                <div class="text-mono" [class]="p.pnl >= 0 ? 'text-bull' : 'text-bear'" style="font-size:0.85rem;">
                  {{ p.pnl >= 0 ? '+' : '' }}₹{{ p.pnl | number:'1.0-0' }}
                </div>
                <div class="stat-pill" style="margin-top:2px;" [class]="p.pnl_pct >= 0 ? 'bull' : 'bear'">
                  {{ p.pnl_pct >= 0 ? '▲' : '▼' }} {{ p.pnl_pct | number:'1.2-2' }}%
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `,
  styles: [`
    .kpi-card { padding: 1rem 1.25rem; }
    .kpi-label { font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 0.3rem; }
    .kpi-value { font-size: 1.5rem; font-weight: 700; font-family: var(--font-mono); }
    .kpi-sub   { margin-top: 0.35rem; font-size: 0.78rem; }

    .signal-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.6rem 0; border-bottom: 1px solid rgba(255,255,255,0.04);
      cursor: pointer; transition: background var(--transition);
      border-radius: var(--radius-sm);
    }
    .signal-row:hover { background: var(--bg-elevated); padding-left: 0.5rem; }
    .signal-row:last-child { border-bottom: none; }
    .signal-main { display: flex; align-items: center; gap: 0.5rem; }
    .signal-symbol { font-weight: 600; font-size: 0.88rem; }
    .signal-strategy { font-size: 0.72rem; }
    .signal-right { display: flex; align-items: center; gap: 0.75rem; font-size: 0.8rem; font-family: var(--font-mono); }

    .thought-bubble {
      display: flex; gap: 0.6rem; align-items: flex-start;
      background: var(--bg-elevated); border-radius: var(--radius-md);
      padding: 0.65rem 0.75rem;
    }
    .thought-icon { font-size: 1rem; margin-top: 1px; }

    .position-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0; border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .position-row:last-child { border-bottom: none; }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private ws = inject(WebSocketService);

  loading = signal(false);
  latestThought = signal<any>(null);
  currentTime = signal('');

  portfolio = this.api.portfolio;
  totalSignals = computed(() => this.api.signals().length);
  topSignals   = computed(() => this.api.signals().slice(0, 8));
  engineOn     = this.api.engineRunning;
  traderOn     = this.api.autoTraderActive;

  private sub?: Subscription;
  private clockTimer?: ReturnType<typeof setInterval>;


  ngOnInit() {
    this.updateClock();
    this.clockTimer = setInterval(() => this.updateClock(), 1000);
    this.loadThoughts();
    this.sub = this.ws.messages$.subscribe(msg => {
      if (msg['type'] === 'trader_thought') this.latestThought.set(msg['thought']);
      if (msg['type'] === 'trade_executed' || msg['type'] === 'position_closed') {
        this.api.getPortfolio().subscribe(p => this.api.portfolio.set(p));
      }
    });
  }

  updateClock() {
    const now = new Date();
    this.currentTime.set(now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST');
  }

  loadThoughts() {
    this.api.getThoughts(1).subscribe(r => {
      if (r.thoughts?.length) this.latestThought.set(r.thoughts[0]);
    });
  }

  refreshAll() {
    this.loading.set(true);
    this.api.getPortfolio().subscribe(p => { this.api.portfolio.set(p); this.loading.set(false); });
    this.api.getSignals().subscribe(r => this.api.signals.set(r.signals || []));
  }

  toggleEngine() {
    if (this.engineOn()) {
      this.api.stopEngine().subscribe(() => this.api.engineRunning.set(false));
    } else {
      this.api.startEngine().subscribe(() => this.api.engineRunning.set(true));
    }
  }

  toggleTrader() {
    if (this.traderOn()) {
      this.api.stopAutoTrader().subscribe(() => this.api.autoTraderActive.set(false));
    } else {
      this.api.startAutoTrader().subscribe(() => this.api.autoTraderActive.set(true));
    }
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    if (this.clockTimer) clearInterval(this.clockTimer);
  }
}
