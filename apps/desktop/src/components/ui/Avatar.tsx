import { currentToken } from '../../lib/api';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { assetUrl } from '../../lib/asset-url';
import { inkOn } from '../../lib/format';

const AVATAR_SIZES = {
  xs: { box: 'size-6 text-[10px]', dot: 'size-2.5 border-2' },
  sm: { box: 'size-8 text-[11px]', dot: 'size-3 border-[3px]' },
  md: { box: 'size-10 text-sm', dot: 'size-3.5 border-[3px]' },
  lg: { box: 'size-20 text-2xl', dot: 'size-5 border-4' },
  xl: { box: 'size-28 text-4xl', dot: 'size-6 border-4' },
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

interface AvatarProps extends ComponentProps<typeof AvatarPrimitive.Root> {
  src?: string | null;
  name: string;
  size?: AvatarSize;
  color?: string;
  /**
   * Sits in the bottom-right corner of the circle, half inside and half out —
   * the Discord presence-dot position. It renders outside the clipped image,
   * so it is never cut off; `badgeRing` paints its ring in the surface colour
   * behind the avatar so it looks punched out.
   */
  badge?: ReactNode;
  badgeRing?: string;
  /** Overlays inside the circle (hover actions); they are never clipped. */
  children?: ReactNode;
}

export function Avatar({
  src,
  name,
  size = 'md',
  color,
  badge,
  badgeRing = 'border-app',
  className,
  children,
  ...props
}: AvatarProps) {
  const sizes = AVATAR_SIZES[size];

  return (
    // no size here: a size passed to the root would also enlarge this wrapper while the
    // circle keeps its preset, leaving a ring of bare background around the image
    <span className="relative inline-flex shrink-0 rounded-full">
      <AvatarPrimitive.Root
        className={cn(
          'relative inline-flex select-none items-center justify-center overflow-hidden rounded-full',
          sizes.box,
          className,
        )}
        {...props}
      >
        {src ? <AvatarPrimitive.Image src={assetUrl(src, { token: currentToken() })} alt={name} className="size-full object-cover" /> : null}
        <AvatarPrimitive.Fallback
          className="flex size-full items-center justify-center font-semibold uppercase"
          style={{
            backgroundColor: color ?? 'var(--color-brand)',
            color: color ? inkOn(color) : 'var(--color-on-brand)',
          }}
          delayMs={src ? 300 : 0}
        >
          {initials(name)}
        </AvatarPrimitive.Fallback>
        {children}
      </AvatarPrimitive.Root>
      {badge ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-0 top-full flex -translate-y-1/2 translate-x-1/4 items-center justify-center rounded-full border-current',
            sizes.dot,
            badgeRing,
          )}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2);
  return `${words[0]![0] ?? ''}${words[words.length - 1]![0] ?? ''}`;
}
