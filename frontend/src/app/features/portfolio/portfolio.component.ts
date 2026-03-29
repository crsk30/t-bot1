import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>💼 Portfolio</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
            Paper Trading Available Capital: ₹{{ portfolio()?.cash | number:'1.0-0' }}
          </div>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Avg Cost</th>
                <th>LTP</th>
                <th>Current Value</th>
                <th>P&L</th>
                <th>P&L %</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let p of portfolio()?.positions">
                <td style="font-weight:700;">{{ p.symbol.replace('.NS','') }}</td>
                <td>{{ p.qty }}</td>
                <td class="text-mono">₹{{ p.avg_price | number:'1.2-2' }}</td>
                <td class="text-mono">₹{{ p.cur_price | number:'1.2-2' }}</td>
                <td class="text-mono">₹{{ p.cur_value | number:'1.2-2' }}</td>
                <td class="text-mono" [class]="p.pnl >= 0 ? 'text-bull' : 'text-bear'">
                  {{ p.pnl >= 0 ? '+' : '' }}₹{{ p.pnl | number:'1.2-2' }}
                </td>
                <td>
                  <span class="stat-pill" [class]="p.pnl_pct >= 0 ? 'bull' : 'bear'">
                    {{ p.pnl_pct >= 0 ? '▲' : '▼' }} {{ p.pnl_pct | number:'1.2-2' }}%
                  </span>
                </td>
                <td>
                  <button class="btn btn-ghost" (click)="closePosition(p.symbol, p.qty)">
                    Close
                  </button>
                </td>
              </tr>
              <tr *ngIf="!portfolio() || portfolio()!.positions.length === 0">
                <td colspan="8" style="text-align:center;padding:3rem;color:var(--text-muted);">
                  No open positions.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 style="margin-top:2rem;margin-bottom:1rem;">Order History</h2>
      
      <div class="card" style="padding:0;">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Direction</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let o of orders()">
                <td class="text-muted text-mono" style="font-size:0.75rem;">{{ o.timestamp | date:'short' }}</td>
                <td style="font-weight:700;">{{ o.symbol.replace('.NS','') }}</td>
                <td>
                  <span class="badge" [class]="o.direction === 'BUY' ? 'badge-buy' : 'badge-sell'">
                    {{ o.direction }}
                  </span>
                </td>
                <td>{{ o.quantity }}</td>
                <td class="text-mono">₹{{ o.filled_price | number:'1.2-2' }}</td>
                <td>
                  <span class="badge" [class]="o.status === 'FILLED' ? 'badge-buy' : 'badge-hold'">
                    {{ o.status }}
                  </span>
                </td>
                <td class="text-muted" style="font-size:0.75rem;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" [title]="o.notes">
                  {{ o.notes }}
                </td>
              </tr>
              <tr *ngIf="orders().length === 0">
                <td colspan="7" style="text-align:center;padding:3rem;color:var(--text-muted);">
                  No recent orders.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class PortfolioComponent {
  private api = inject(ApiService);
  
  portfolio = this.api.portfolio;
  orders = this.api.orders;
  
  constructor() {
    this.loadOrders();
  }

  loadOrders() {
    this.api.getOrders(50).subscribe(res => {
      this.orders.set(res.orders || []);
    });
  }

  closePosition(symbol: string, qty: number) {
    if (confirm(`Close position ${qty}x ${symbol}?`)) {
        this.api.placeOrder(symbol, 'SELL', qty, 'MANUAL CLOSE').subscribe(() => {
            this.api.getPortfolio().subscribe(p => this.api.portfolio.set(p));
            this.loadOrders();
        });
    }
  }
}
