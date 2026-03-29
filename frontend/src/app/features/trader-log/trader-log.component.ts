import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, TraderThought } from '../../core/api.service';
import { WebSocketService } from '../../core/websocket.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-trader-log',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>🧠 AutoTrader Thought Journal</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
             Real-time stream of the agent's decision-making process
          </div>
        </div>
        <div class="flex gap-2">
            <button class="btn btn-primary" (click)="refresh()"[disabled]="loading()">
                {{ loading() ? '⏳' : '🔄' }} Refresh
            </button>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 120px;">Time</th>
                <th style="width: 60px;">Verdict</th>
                <th style="width: 120px;">Action</th>
                <th style="width: 120px;">Symbol</th>
                <th>Reasoning</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let t of thoughts()" [class]="t.decided ? '' : 'text-muted'">
                <td class="text-mono" style="font-size: 0.75rem;">{{ t.timestamp | date:'shortTime' }}</td>
                <td style="text-align: center; font-size: 1.1rem;">
                    {{ t.decided ? '✅' : '❌' }}
                </td>
                <td>
                    <span class="badge" [class]="getBadgeClass(t.action)">
                        {{ t.action.replace('EVALUATE_', 'EVAL ') }}
                    </span>
                </td>
                <td style="font-weight:600;">{{ t.symbol.replace('.NS','') }}</td>
                <td style="font-size: 0.8rem; max-width: 500px; line-height: 1.4;">
                    {{ t.reasoning }}
                </td>
              </tr>
              <tr *ngIf="thoughts().length === 0">
                <td colspan="5" style="text-align:center;padding:3rem;color:var(--text-muted);">
                  The thought journal is empty. Start the engine and AutoTrader.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class TraderLogComponent implements OnInit, OnDestroy {
    thoughts = signal<TraderThought[]>([]);
    loading = signal(false);
    private sub?: Subscription;

    constructor(private api: ApiService, private ws: WebSocketService) {}

    ngOnInit() {
        this.refresh();
        this.sub = this.ws.messages$.subscribe(msg => {
            if (msg['type'] === 'trader_thought') {
                const thought = msg['thought'] as TraderThought;
                this.thoughts.update(current => [thought, ...current].slice(0, 100)); // Keep latest 100
            }
        });
    }

    refresh() {
        this.loading.set(true);
        this.api.getThoughts(100).subscribe(res => {
            this.thoughts.set(res.thoughts || []);
            this.loading.set(false);
        });
    }

    getBadgeClass(action: string) {
        if (action.includes('BUY')) return 'badge-buy';
        if (action.includes('SELL') || action.includes('EXIT')) return 'badge-sell';
        if (action.includes('START') || action.includes('STOP')) return 'badge-open';
        return 'badge-hold';
    }

    ngOnDestroy() {
        this.sub?.unsubscribe();
    }
}
