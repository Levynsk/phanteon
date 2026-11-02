const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Hoje';
  if (sameDay(date, yesterday)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function formatRelativeShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return RELATIVE_FORMATTER.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return RELATIVE_FORMATTER.format(-hours, 'hour');
  return RELATIVE_FORMATTER.format(-Math.round(hours / 24), 'day');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Groups messages that arrive within this window from the same author. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** "Hoje às 14:32", "Ontem às 09:10" or "12 de outubro de 2026 às 08:00". */
export function formatMessageTimestamp(iso: string): string {
  return `${formatDateSeparator(iso)} às ${formatTime(iso)}`;
}

/**
 * Readable text colour for a solid fill with an arbitrary colour (server icons):
 * dark ink on pale fills, white on saturated ones. Hex input only; anything
 * else falls back to white.
 */
export function inkOn(color: string): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return '#ffffff';
  const hex = match[1]!.length === 3 ? match[1]!.split('').map((c) => c + c).join('') : match[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
  return luminance > 0.45 ? '#1a1a1c' : '#ffffff';
}
