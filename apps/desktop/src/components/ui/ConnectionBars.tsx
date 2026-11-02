import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { SignalHigh, SignalLow, SignalMedium, SignalZero } from 'lucide-react';
import { realtime } from '../../lib/realtime';
import { cn } from '../../lib/cn';

/** Quality buckets, the same thresholds Discord uses for its connection bars. */
export type SignalQuality = 'good' | 'ok' | 'poor' | 'offline';

export const SIGNAL_STYLE: Record<SignalQuality, { icon: LucideIcon; label: string; color: string }> = {
  good: { icon: SignalHigh, label: 'Conexão ótima', color: 'text-green' },
  ok: { icon: SignalMedium, label: 'Conexão boa', color: 'text-yellow' },
  poor: { icon: SignalLow, label: 'Conexão instável', color: 'text-red' },
  offline: { icon: SignalZero, label: 'Sem conexão', color: 'text-red' },
};

export function qualityOf(ms: number | null): SignalQuality {
  if (ms === null) return 'offline';
  if (ms < 120) return 'good';
  if (ms < 250) return 'ok';
  return 'poor';
}

/** Latency to the chat server, sampled from the socket heartbeat. */
export function useServerPing(): number | null {
  const [ms, setMs] = useState<number | null>(() => realtime.ping());
  useEffect(() => realtime.onPing(setMs), []);
  return ms;
}

/**
 * Round-trip time to the server, drawn as signal bars plus the number. It lives
 * in the call strip, where connection quality matters, and leaves the presence
 * dot on the avatar untouched. `muted` keeps it on the theme's text colours so
 * it blends into a strip instead of shouting a status colour.
 */
export function ConnectionBars({ inline = false, muted = false, className }: { inline?: boolean; muted?: boolean; className?: string }) {
  const ms = useServerPing();
  const quality = qualityOf(ms);
  const { icon: Icon, label, color } = SIGNAL_STYLE[quality];
  return (
    <span
      className={cn('pointer-events-none flex shrink-0 items-center gap-1', className)}
      title={ms === null ? label : `${label} · ${ms} ms`}
      aria-label={ms === null ? label : `${label}, ${ms} milissegundos`}
      role="img"
    >
      <Icon size={inline ? 12 : 13} className={muted ? 'text-muted' : color} aria-hidden />
      <span className={cn('text-[10px] font-semibold tabular-nums leading-none', muted ? 'text-muted' : color)}>
        {ms === null ? '—' : `${ms} ms`}
      </span>
    </span>
  );
}
