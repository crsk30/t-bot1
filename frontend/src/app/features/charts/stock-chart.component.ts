import { Component, OnInit, OnDestroy, ElementRef, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { createChart, IChartApi, ISeriesApi, ColorType, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { ApiService } from '../../core/api.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-stock-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page" style="height: calc(100vh - 40px); display: flex; flex-direction: column;">
      <div class="page-header" style="margin-bottom: 0.5rem;">
        <div>
          <h1 class="flex items-center gap-2">
            📈 {{ symbol().replace('.NS', '') }} 
            <span class="text-muted" style="font-size: 1rem; font-weight: 500;">NSE</span>
          </h1>
          <div *ngIf="quote()" class="flex items-center gap-3 mt-1 text-mono">
            <span style="font-size: 1.25rem; font-weight: 700;">₹{{ quote().last_price | number:'1.2-2' }}</span>
            <span [class]="quote().change >= 0 ? 'text-bull' : 'text-bear'" style="font-size: 0.9rem;">
              {{ quote().change >= 0 ? '▲' : '▼' }} ₹{{ quote().change | number:'1.2-2' }} 
              ({{ quote().change_pct | number:'1.2-2' }}%)
            </span>
            <span class="text-muted" style="font-size: 0.8rem;">Vol: {{ quote().volume | number }}</span>
          </div>
          <div *ngIf="!quote()" class="skeleton mt-1" style="height: 30px; width: 250px;"></div>
        </div>

        <div class="flex gap-2">
            <select class="input" style="width: 100px;" [value]="period()" (change)="changePeriod($event)">
                <option value="1mo">1 Month</option>
                <option value="3mo">3 Months</option>
                <option value="6mo">6 Months</option>
                <option value="1y">1 Year</option>
                <option value="2y">2 Years</option>
                <option value="5y">5 Years</option>
            </select>
        </div>
      </div>

      <!-- Trade Controls -->
      <div class="card flex items-center justify-between" style="padding: 0.75rem 1.25rem; margin-bottom: 1rem; border-radius: var(--radius-md);">
        <div class="flex items-center gap-3">
            <input type="number" #qtyInput class="input text-mono" style="width: 100px;" value="1" min="1" placeholder="Qty">
            <button class="btn btn-bull" (click)="placeManualOrder('BUY', qtyInput.value)" [disabled]="placingOrder()">
                Buy Market
            </button>
            <button class="btn btn-bear" (click)="placeManualOrder('SELL', qtyInput.value)" [disabled]="placingOrder()">
                Sell Market
            </button>
        </div>
        
        <div class="flex items-center gap-4 text-mono text-muted" style="font-size: 0.8rem;" *ngIf="indicators()">
            <div>RSI: <span [class]="indicators().rsi > 70 ? 'text-bear' : indicators().rsi < 30 ? 'text-bull' : 'text-primary'">{{ indicators().rsi | number:'1.1-1' }}</span></div>
            <div>MACD: <span>{{ indicators().macd | number:'1.2-2' }}</span></div>
            <div>EMA20: <span>₹{{ indicators().ema20 | number:'1.2-2' }}</span></div>
            <div>EMA200: <span>₹{{ indicators().ema200 | number:'1.2-2' }}</span></div>
        </div>
        <div *ngIf="!indicators()" class="skeleton" style="height: 20px; width: 300px;"></div>
      </div>

      <div class="card" style="flex: 1; padding: 0; position: relative; display: flex; flex-direction: column;">
        <div *ngIf="loading()" class="chart-loading">
            <div class="spinner"></div> Loading chart data...
        </div>
        <div #chartContainer style="flex: 1; width: 100%;"></div>
      </div>
    </div>
  `,
  styles: [`
    .chart-loading {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(10, 14, 26, 0.7);
        z-index: 10;
        color: var(--text-muted);
        gap: 1rem;
    }
    .spinner {
        width: 30px; height: 30px;
        border: 3px solid var(--border);
        border-top-color: var(--accent);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class StockChartComponent implements OnInit, OnDestroy {
  @ViewChild('chartContainer', { static: true }) chartContainer!: ElementRef;
  
  symbol = signal<string>('');
  quote = signal<any>(null);
  indicators = signal<any>(null);
  loading = signal(false);
  period = signal('6mo');
  placingOrder = signal(false);
  
  private chart!: IChartApi;
  private candlestickSeries!: ISeriesApi<"Candlestick">;
  private volumeSeries!: ISeriesApi<"Histogram">;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private api: ApiService
  ) {}

  ngOnInit() {
    this.initChart();
    
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
        const sym = params.get('symbol') || 'RELIANCE.NS';
        this.symbol.set(sym);
        this.loadData();
    });

    // Handle resize
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = () => {
      if (this.chartContainer?.nativeElement && this.chart) {
          this.chart.applyOptions({
              width: this.chartContainer.nativeElement.clientWidth,
              height: this.chartContainer.nativeElement.clientHeight
          });
      }
  };

  initChart() {
    this.chart = createChart(this.chartContainer.nativeElement, {
        layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#94a3b8',
        },
        grid: {
            vertLines: { color: 'rgba(255,255,255,0.04)' },
            horzLines: { color: 'rgba(255,255,255,0.04)' },
        },
        crosshair: {
            mode: 0,
        },
        rightPriceScale: {
            borderColor: 'rgba(255,255,255,0.1)',
        },
        timeScale: {
            borderColor: 'rgba(255,255,255,0.1)',
            timeVisible: true,
        },
    });

    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
    });

    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '', // set as an overlay
    });

    this.volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
    });
    
    setTimeout(this.handleResize, 0);
  }

  loadData() {
      this.loading.set(true);
      const sym = this.symbol();
      
      this.api.getQuote(sym).subscribe(q => this.quote.set(q));
      this.api.getIndicators(sym).subscribe(ind => this.indicators.set(ind?.indicators));
      
      this.api.getChart(sym, this.period(), '1d').subscribe({
          next: (res) => {
              if (res && res.data && res.data.length) {
                  const ohlc = res.data.map((d: any) => ({
                      time: d.time, open: d.open, high: d.high, low: d.low, close: d.close
                  }));
                  const vol = res.data.map((d: any) => ({
                      time: d.time, value: d.volume,
                      color: d.close >= d.open ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                  }));
                  
                  this.candlestickSeries.setData(ohlc);
                  this.volumeSeries.setData(vol);
                  this.chart.timeScale().fitContent();
              }
              this.loading.set(false);
          },
          error: () => this.loading.set(false)
      });
  }

  changePeriod(event: Event) {
      const p = (event.target as HTMLSelectElement).value;
      this.period.set(p);
      this.loadData();
  }

  placeManualOrder(direction: string, qtyStr: string) {
      const qty = parseInt(qtyStr, 10);
      if (!qty || qty <= 0) return;
      
      this.placingOrder.set(true);
      this.api.placeOrder(this.symbol(), direction, qty, 'MANUAL_TRADE').subscribe({
          next: () => {
              this.placingOrder.set(false);
              // App shell handles toast
          },
          error: () => this.placingOrder.set(false)
      });
  }

  ngOnDestroy() {
      window.removeEventListener('resize', this.handleResize);
      this.destroy$.next();
      this.destroy$.complete();
      if (this.chart) {
          this.chart.remove();
      }
  }
}
