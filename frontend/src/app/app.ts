import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { WebSocketService, WsMessage } from './core/websocket.service';
import { ApiService } from './core/api.service';
import { Subscription } from 'rxjs';

interface NavItem { label: string; icon: string; route: string; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  template: `
    <div class="shell">
      <!-- Sidebar -->
      <nav class="sidebar">
        <div class="brand">
          <div class="brand-logo">⚡</div>
          <div>
            <div class="brand-name">AlgoNSE</div>
            <div class="brand-sub">Swing Trader</div>
          </div>
        </div>

        <div class="ws-status" [class.connected]="wsService.connected()">
          <span class="dot"></span>
          <span>{{ wsService.connected() ? 'Live' : 'Connecting...' }}</span>
        </div>

        <div class="nav-group">
          <a *ngFor="let item of navItems"
             [routerLink]="item.route"
             routerLinkActive="active"
             class="nav-item">
            <span class="nav-icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </a>
        </div>

        <div class="sidebar-footer">
          <div class="engine-badge" [class.running]="apiService.engineRunning()">
            <span class="dot"></span>
            Engine {{ apiService.engineRunning() ? 'Running' : 'Stopped' }}
          </div>
          <div class="trader-badge" [class.active]="apiService.autoTraderActive()">
            <span class="dot"></span>
            AutoTrader {{ apiService.autoTraderActive() ? 'Active' : 'Idle' }}
          </div>
          <div class="paper-badge">📄 Paper Mode</div>
        </div>
      </nav>

      <!-- Main content -->
      <main class="main-area">
        <router-outlet />
      </main>

      <!-- Toast notifications -->
      <div *ngIf="toast()" class="toast" [class]="'toast-' + toastType()">
        {{ toast() }}
      </div>
    </div>
  `,
  styles: [`
    .shell { display: flex; height: 100vh; overflow: hidden; }

    /* ── Sidebar ── */
    .sidebar {
      width: 220px;
      min-width: 220px;
      background: var(--bg-surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 1.25rem 0;
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0 1.25rem 1rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1rem;
    }
    .brand-logo {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #3b82f6, #06b6d4);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem;
      box-shadow: 0 0 12px rgba(59,130,246,0.4);
    }
    .brand-name { font-weight: 700; font-size: 1.05rem; line-height: 1; }
    .brand-sub  { font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; }

    .ws-status {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.3rem 1.25rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }
    .ws-status .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--bear); }
    .ws-status.connected { color: var(--bull); }
    .ws-status.connected .dot { background: var(--bull); box-shadow: 0 0 6px var(--bull-glow); }

    .nav-group { flex: 1; padding: 0 0.75rem; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.6rem 0.85rem;
      border-radius: var(--radius-md);
      text-decoration: none;
      color: var(--text-secondary);
      font-size: 0.875rem;
      font-weight: 450;
      transition: all var(--transition);
      margin-bottom: 2px;
    }
    .nav-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
    .nav-item.active {
      background: var(--accent-dim);
      color: var(--text-accent);
      font-weight: 600;
      border: 1px solid var(--border-accent);
    }
    .nav-icon { font-size: 1rem; min-width: 20px; text-align: center; }

    .sidebar-footer {
      padding: 1rem 1.25rem 0;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .engine-badge, .trader-badge {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      color: var(--text-muted);
      font-family: var(--font-mono);
    }
    .engine-badge .dot, .trader-badge .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--text-muted);
    }
    .engine-badge.running { color: var(--bull); }
    .engine-badge.running .dot { background: var(--bull); }
    .trader-badge.active { color: var(--neutral); }
    .trader-badge.active .dot { background: var(--neutral); animation: pulseBull 1.5s infinite; }
    .paper-badge { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem; }

    /* ── Main ── */
    .main-area {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-base);
      position: relative;
      z-index: 1;
    }

    /* ── Toast ── */
    .toast { border-left: 3px solid var(--accent); }
    .toast-bull { border-left-color: var(--bull); color: var(--bull); }
    .toast-bear { border-left-color: var(--bear); color: var(--bear); }
  `]
})
export class App implements OnInit, OnDestroy {
  navItems: NavItem[] = [
    { label: 'Dashboard',    icon: '📊', route: '/dashboard' },
    { label: 'Signals',      icon: '⚡', route: '/signals' },
    { label: 'Portfolio',    icon: '💼', route: '/portfolio' },
    { label: 'Charts',       icon: '📈', route: '/charts/RELIANCE.NS' },
    { label: 'Backtest',     icon: '🔬', route: '/backtest' },
    { label: 'Watchlist',    icon: '👁', route: '/watchlist' },
    { label: 'Trader Log',   icon: '🧠', route: '/trader-log' },
  ];

  toast = signal<string>('');
  toastType = signal<string>('');
  private sub?: Subscription;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    public wsService: WebSocketService,
    public apiService: ApiService
  ) {}

  ngOnInit() {
    this.wsService.connect();
    this.loadInitialState();

    this.sub = this.wsService.messages$.subscribe((msg: WsMessage) => {
      this.handleWsMessage(msg);
    });
  }

  loadInitialState() {
    this.apiService.getEngineStatus().subscribe(s => {
      this.apiService.engineRunning.set(s.running);
    });
    this.apiService.getAutoTraderStatus().subscribe(s => {
      this.apiService.autoTraderActive.set(s.is_active);
    });
    this.apiService.getPortfolio().subscribe(p => {
      this.apiService.portfolio.set(p);
    });
    this.apiService.getSignals().subscribe(r => {
      this.apiService.signals.set(r.signals || []);
    });
  }

  handleWsMessage(msg: WsMessage) {
    switch (msg['type']) {
      case 'signals_update':
        this.apiService.signals.set((msg['signals'] as any[]) || []);
        break;
      case 'trade_executed':
        const order = msg['order'] as any;
        this.showToast(`🟢 ${order?.direction} ${order?.quantity}× ${order?.symbol} @ ₹${order?.filled_price}`, 'bull');
        this.apiService.getPortfolio().subscribe(p => this.apiService.portfolio.set(p));
        break;
      case 'position_closed':
        const pnl = msg['pnl'] as number;
        const sym = msg['symbol'] as string;
        this.showToast(
          `${pnl >= 0 ? '💰' : '🔴'} ${sym} closed. P&L: ₹${pnl >= 0 ? '+' : ''}${pnl?.toFixed(2)}`,
          pnl >= 0 ? 'bull' : 'bear'
        );
        this.apiService.getPortfolio().subscribe(p => this.apiService.portfolio.set(p));
        break;
    }
  }

  showToast(msg: string, type = '') {
    this.toast.set(msg);
    this.toastType.set(type);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 5000);
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    this.wsService.disconnect();
  }
}
