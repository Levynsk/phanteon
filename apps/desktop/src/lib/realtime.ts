import type { ClientEvent, RtcSignalData, ServerEvent, SocketStatus } from '@phanteon/shared';
import { getApiUrl, toWebSocketUrl } from './config';

type EventListener = (event: ServerEvent) => void;
type StatusListener = (status: SocketStatus) => void;

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;
const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * Thin reconnecting wrapper over the realtime socket. It re-subscribes to the
 * tracked channels after every reconnect so the UI never has to care.
 */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closedByClient = false;
  private readonly subscriptions = new Set<string>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly pingListeners = new Set<(ms: number | null) => void>();
  private status: SocketStatus = 'closed';
  private lastPingMs: number | null = null;
  private pendingPingAt: number | null = null;

  connect(token: string): void {
    this.token = token;
    this.closedByClient = false;
    this.open();
  }

  disconnect(): void {
    this.closedByClient = true;
    this.token = null;
    this.clearTimers();
    this.pendingPingAt = null;
    this.setPing(null);
    this.socket?.close();
    this.socket = null;
    this.setStatus('closed');
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(channelIds: string[]): void {
    const fresh = channelIds.filter((id) => !this.subscriptions.has(id));
    for (const id of fresh) this.subscriptions.add(id);
    if (fresh.length > 0) this.send({ type: 'subscribe', channelIds: fresh });
  }

  unsubscribe(channelIds: string[]): void {
    const removed = channelIds.filter((id) => this.subscriptions.delete(id));
    if (removed.length > 0) this.send({ type: 'unsubscribe', channelIds: removed });
  }

  startTyping(channelId: string): void {
    this.send({ type: 'typing', channelId });
  }

  /** Relays a WebRTC offer/answer/candidate to another participant. */
  sendSignal(to: string, channelId: string, data: RtcSignalData): void {
    this.send({ type: 'rtc:signal', to, channelId, data });
  }

  setSpeaking(speaking: boolean): void {
    this.send({ type: 'voice:speaking', speaking });
  }

  /** Round-trip time to the server in ms (the `pong` reply to a `ping`), or null while connecting. */
  ping(): number | null {
    return this.lastPingMs;
  }

  onPing(listener: (ms: number | null) => void): () => void {
    this.pingListeners.add(listener);
    return () => this.pingListeners.delete(listener);
  }

  private open(): void {
    if (!this.token) return;
    this.clearTimers();
    this.setStatus('connecting');

    let socket: WebSocket;
    try {
      socket = new WebSocket(toWebSocketUrl(getApiUrl()));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempt = 0;
      this.setStatus('open');
      // authenticate before anything else; the server sends `ready` only after this
      this.send({ type: 'auth', token: this.token ?? '' });
      if (this.subscriptions.size > 0) {
        this.send({ type: 'subscribe', channelIds: [...this.subscriptions] });
      }
      this.heartbeat = setInterval(() => this.sendPing(), HEARTBEAT_INTERVAL_MS);
      // a first reading right away, so the dock never shows "medindo…" for long
      this.sendPing();
    });

    socket.addEventListener('message', (event) => {
      let payload: ServerEvent;
      try {
        payload = JSON.parse(String(event.data)) as ServerEvent;
      } catch {
        return;
      }
      if ((payload as { type: string }).type === 'pong') {
        this.receivePong();
        return;
      }
      for (const listener of this.eventListeners) listener(payload);
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      this.pendingPingAt = null;
      this.setPing(null);
      this.setStatus('closed');
      if (!this.closedByClient) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByClient || !this.token) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private sendPing(): void {
    this.pendingPingAt = Date.now();
    this.send({ type: 'ping' });
  }

  private receivePong(): void {
    if (this.pendingPingAt === null) return;
    const elapsed = Date.now() - this.pendingPingAt;
    this.pendingPingAt = null;
    // smooth so the label does not jump between samples
    const next = this.lastPingMs === null ? elapsed : Math.round(this.lastPingMs * 0.6 + elapsed * 0.4);
    this.setPing(next);
  }

  private setPing(ms: number | null): void {
    if (this.lastPingMs === ms) return;
    this.lastPingMs = ms;
    for (const listener of this.pingListeners) listener(ms);
  }

  private send(event: ClientEvent): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(event));
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.reconnectTimer = null;
    this.heartbeat = null;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }
}

export const realtime = new RealtimeClient();
