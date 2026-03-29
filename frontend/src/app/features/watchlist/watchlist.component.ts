import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-watchlist',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1>👁 Watchlist</h1>
          <div class="text-muted" style="font-size:0.8rem;margin-top:0.2rem;">
             Manage stocks the engine scans for signals
          </div>
        </div>
      </div>

      <div class="card" style="max-width: 600px;">
        <div class="flex gap-2" style="margin-bottom: 1.5rem;">
            <input type="text" class="input flex-1" [(ngModel)]="newSymbol" placeholder="Add symbol (e.g. INFY.NS)" (keyup.enter)="addSymbol()">
            <button class="btn btn-primary" (click)="addSymbol()" [disabled]="!newSymbol">Add</button>
        </div>

        <div *ngIf="saving()" style="margin-bottom: 1rem; color: var(--accent); font-size: 0.85rem;">Saving...</div>

        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <div *ngFor="let s of watchlist()" class="flex items-center justify-between" style="padding: 0.6rem 1rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border);">
                <div class="font-weight: 600;">{{ s }}</div>
                <button class="btn btn-ghost" style="padding: 0.2rem 0.6rem; color: var(--bear);" (click)="removeSymbol(s)">
                    Remove
                </button>
            </div>
            <div *ngIf="watchlist().length === 0" class="text-muted" style="text-align: center; padding: 2rem;">
                Watchlist is empty.
            </div>
        </div>
      </div>
    </div>
  `
})
export class WatchlistComponent implements OnInit {
    watchlist = signal<string[]>([]);
    newSymbol = '';
    saving = signal(false);

    constructor(private api: ApiService) {}

    ngOnInit() {
        this.load();
    }

    load() {
        this.api.getWatchlist().subscribe(w => this.watchlist.set(w.watchlist || []));
    }

    addSymbol() {
        if (!this.newSymbol) return;
        const sym = this.newSymbol.toUpperCase().trim();
        const current = this.watchlist();
        if (!current.includes(sym)) {
            const next = [...current, sym];
            this.save(next);
        }
        this.newSymbol = '';
    }

    removeSymbol(sym: string) {
        const next = this.watchlist().filter(s => s !== sym);
        this.save(next);
    }

    save(list: string[]) {
        this.saving.set(true);
        this.api.updateWatchlist(list).subscribe({
            next: (res) => {
                this.watchlist.set(res.watchlist);
                this.saving.set(false);
            },
            error: () => this.saving.set(false)
        });
    }
}
