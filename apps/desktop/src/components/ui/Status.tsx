import type { UserStatus } from '@phanteon/shared';
import { cn } from '../../lib/cn';

const STATUS_COLOR: Record<UserStatus, string> = {
  online: 'bg-green',
  idle: 'bg-yellow',
  dnd: 'bg-red',
  offline: 'bg-muted',
};

const STATUS_LABEL: Record<UserStatus, string> = {
  online: 'Disponível',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline',
};

export { STATUS_LABEL };

/** Small coloured dot used inline (menus, legendas). */
export function StatusDot({ status, className }: { status: UserStatus; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-full', STATUS_COLOR[status], className)}
      role="img"
      aria-label={STATUS_LABEL[status]}
    />
  );
}

/**
 * Surface colours the ring must match so it reads as a cut-out. `image` is for
 * dots laid over a banner or avatar backdrop, where a fixed scrim sits on top;
 * `overlay` is kept for panels that paint their own dark scrim.
 */
const RING: Record<'surface' | 'surface-alt' | 'chat' | 'app' | 'elevated' | 'image' | 'overlay', string> = {
  surface: 'border-sidebar',
  'surface-alt': 'border-sidebar',
  chat: 'border-chat',
  app: 'border-app',
  elevated: 'border-elevated',
  // a dark scrim over a banner: no theme colour matches, so use a neutral dark
  image: 'border-[#1a1a1c]',
  overlay: 'border-[#1a1a1c]',
};

/**
 * Status dot overlaid on an avatar. Its bottom-right quarter sits outside the
 * avatar, centred on the corner, and the ring is painted with the surface
 * colour so it looks punched out of the avatar.
 */
export function StatusBadge({
  status,
  ring = 'surface',
  size = 'md',
  className,
}: {
  status: UserStatus;
  ring?: keyof typeof RING;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={cn(
        // plain offsets instead of Tailwind translate utilities, which other layers reset
        'pointer-events-none absolute rounded-full',
        size === 'sm' ? 'bottom-[-1px] right-[-3px] size-3 border-2' : 'bottom-[-3px] right-[-5px] size-5 border-[3px]',
        STATUS_COLOR[status],
        RING[ring],
        className,
      )}
      role="img"
      aria-label={STATUS_LABEL[status]}
    />
  );
}
