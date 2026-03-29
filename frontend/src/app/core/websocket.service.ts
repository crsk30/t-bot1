import { Injectable, signal, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connected = signal(false);
  lastMessage = signal<WsMessage | null>(null);

  private messageSubject = new Subject<WsMessage>();
  messages$ = this.messageSubject.asObservable();

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.intentionalClose = false;
    this.ws = new WebSocket(environment.wsUrl);

    this.ws.onopen = () => {
      this.connected.set(true);
      console.log('[WS] Connected');
      // Start heartbeat
      this.startPing();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg: WsMessage = JSON.parse(ev.data);
        this.lastMessage.set(msg);
        this.messageSubject.next(msg);
      } catch { /* ignore parse errors */ }
    };

    this.ws.onclose = () => {
      this.connected.set(false);
      if (!this.intentionalClose) {
        console.log('[WS] Connection lost. Reconnecting in 3s...');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error', err);
    };
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private startPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.connected.set(false);
  }

  ngOnDestroy() { this.disconnect(); }
}
