import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent)
  },
  {
    path: 'signals',
    loadComponent: () => import('./features/signals/signals.component').then(m => m.SignalsComponent)
  },
  {
    path: 'portfolio',
    loadComponent: () => import('./features/portfolio/portfolio.component').then(m => m.PortfolioComponent)
  },
  {
    path: 'charts/:symbol',
    loadComponent: () => import('./features/charts/stock-chart.component').then(m => m.StockChartComponent)
  },
  {
    path: 'backtest',
    loadComponent: () => import('./features/backtest/backtest.component').then(m => m.BacktestComponent)
  },
  {
    path: 'watchlist',
    loadComponent: () => import('./features/watchlist/watchlist.component').then(m => m.WatchlistComponent)
  },
  {
    path: 'trader-log',
    loadComponent: () => import('./features/trader-log/trader-log.component').then(m => m.TraderLogComponent)
  },
  { path: '**', redirectTo: 'dashboard' }
];
