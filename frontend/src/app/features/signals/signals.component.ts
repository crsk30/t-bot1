import { Component, OnInit, OnDestroy, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, Signal } from '../../core/api.service';
import { WebSocketService } from '../../core/websocket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>⚡ Signals</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
            {{ signals().length }} active signals across {{ strategies().length }} strategies
          </div>
        </div>
        <div class="flex gap-2 items-center">
          <!-- Filter -->
          <select class="input" style="width:130px;" (change)="setFilter($event)">
            <option value="">All Signals</option>
            <option value="BUY">BUY Only</option>
            <option value="SELL">SELL Only</option>
          </select>
          <select class="input" style="width:160px;" (change)="setStrategyFilter($event)">
            <option value="">All Strategies</option>
            <option *ngFor="let s of strategies()" [value]="s">{{ s }}</option>
          </select>
          <button class="btn btn-primary" (click)="scanNow()" [disabled]="scanning()">
            {{ scanning() ? '⏳ Scanning...' : '🔍 Scan Now' }}
          </button>
        </div>
      </div>

      <!-- Summary chips -->
      <div class="flex gap-2" style="margin-bottom:1rem;">
        <div class="card" style="padding:0.6rem 1rem;flex:1;">
          <div class="text-muted" style="font-size:0.7rem;">BUY Signals</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--bull);">{{ buyCount() }}</div>
        </div>
        <div class="card" style="padding:0.6rem 1rem;flex:1;">
          <div class="text-muted" style="font-size:0.7rem;">SELL Signals</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--bear);">{{ sellCount() }}</div>
        </div>
        <div class="card" style="padding:0.6rem 1rem;flex:1;">
          <div class="text-muted" style="font-size:0.7rem;">Avg Strength</div>
          <div style="font-size:1.4rem;font-weight:700;color:var(--neutral);">{{ avgStrength() | number:'1.0-0' }}</div>
        </div>
        <div class="card" style="padding:0.6rem 1rem;flex:2;min-width:200px;">
          <div class="text-muted" style="font-size:0.7rem;">Last Scan</div>
          <div style="font-size:0.9rem;font-weight:600;font-family:var(--font-mono);">{{ lastScanTime() }}</div>
        </div>
      </div>

      <!-- Signals table -->
      <div class="card" style="padding:0;">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Signal</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Price</th>
                <th>Stop Loss</th>
                <th>Target</th>
                <th>R:R</th>
                <th>P/E</th>
                <th>Strength</th>
                <th>Reasoning</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let s of filteredSignals()" class="signal-tr">
                <td>
                  <span class="badge" [class]="'badge-' + s.signal.toLowerCase()">{{ s.signal }}</span>
                </td>
                <td style="font-weight:700;">{{ s.symbol.replace('.NS','') }}</td>
                <td>
                  <span class="strategy-chip">{{ s.strategy }}</span>
                </td>
                <td class="text-mono">₹{{ s.price | number:'1.2-2' }}</td>
                <td class="text-mono text-bear">₹{{ s.stop_loss | number:'1.2-2' }}</td>
                <td class="text-mono text-bull">₹{{ s.target | number:'1.2-2' }}</td>
                <td class="text-mono">
                  <span [class]="s.risk_reward >= 2 ? 'text-bull' : s.risk_reward >= 1.5 ? 'text-neutral' : 'text-bear'">
                    {{ s.risk_reward }}:1
                  </span>
                </td>
                <td class="text-mono text-muted">
                  {{ (s.pe_ratio || 0) > 0 ? (s.pe_ratio | number:'1.1-1') : 'N/A' }}
                </td>
                <td style="min-width:100px;">
                  <div class="flex items-center gap-2">
                    <div class="strength-bar" style="flex:1;">
                      <div class="strength-fill"
                           [style.width]="s.strength + '%'"
                           [style.background]="s.signal === 'BUY' ? 'var(--bull)' : 'var(--bear)'">
                      </div>
                    </div>
                    <span style="font-family:var(--font-mono);font-size:0.75rem;min-width:28px;">{{ s.strength | number:'1.0-0' }}</span>
                  </div>
                </td>
                <td style="max-width:240px;">
                  <div class="reasoning-text" [title]="s.reasoning">{{ s.reasoning | slice:0:80 }}...</div>
                </td>
                <td class="text-muted text-mono" style="font-size:0.72rem;white-space:nowrap;">
                  {{ s.timestamp | date:'HH:mm:ss' }}
                </td>
                <td>
                  <a [routerLink]="['/charts', s.symbol]" class="btn btn-ghost" style="padding:0.25rem 0.6rem;font-size:0.75rem;">
                    Chart →
                  </a>
                </td>
              </tr>
              <tr *ngIf="filteredSignals().length === 0">
                <td colspan="11" style="text-align:center;padding:3rem;color:var(--text-muted);">
                  No signals match the current filter. Start the engine or trigger a scan.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .strategy-chip {
      background: var(--accent-dim);
      color: var(--text-accent);
      border-radius: 999px;
      padding: 0.1rem 0.5rem;
      font-size: 0.7rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .reasoning-text { font-size: 0.78rem; color: var(--text-secondary); line-height: 1.3; }
  `]
})
export class SignalsComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  private ws = inject(WebSocketService);

  signals = this.api.signals;
  scanning = signal(false);
  lastScanTime = signal('—');
  filterType = signal('');
  filterStrategy = signal('');

  buyCount   = computed(() => this.signals().filter(s => s.signal === 'BUY').length);
  sellCount  = computed(() => this.signals().filter(s => s.signal === 'SELL').length);
  avgStrength = computed(() => {
    const s = this.signals();
    return s.length ? s.reduce((a, b) => a + b.strength, 0) / s.length : 0;
  });
  strategies = computed(() => [...new Set(this.signals().map(s => s.strategy))]);
  filteredSignals = computed(() => {
    let s = this.signals();
    if (this.filterType()) s = s.filter(x => x.signal === this.filterType());
    if (this.filterStrategy()) s = s.filter(x => x.strategy === this.filterStrategy());
    return s;
  });

  private sub?: Subscription;

  ngOnInit() {
    this.sub = this.ws.messages$.subscribe(msg => {
      if (msg['type'] === 'signals_update') {
        this.lastScanTime.set(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }));
      }
    });
  }

  setFilter(e: Event) { this.filterType.set((e.target as HTMLSelectElement).value); }
  setStrategyFilter(e: Event) { this.filterStrategy.set((e.target as HTMLSelectElement).value); }

  scanNow() {
    this.scanning.set(true);
    this.api.scanNow().subscribe(r => {
      this.api.signals.set(r.signals || []);
      this.lastScanTime.set(new Date().toLocaleTimeString());
      this.scanning.set(false);
    });
  }

  ngOnDestroy() { this.sub?.unsubscribe(); }
}
