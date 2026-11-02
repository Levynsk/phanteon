import { useEffect, useRef } from 'react';

interface StarfieldProps {
  /** Extra star density on top of the base amount (0 keeps it calm). */
  density?: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: number;
  life: number;
  maxLife: number;
}

const CELL_W = 9;
const CELL_H = 15;

/**
 * ASCII starfield painted behind the sign-in screen. It fills the whole window
 * behind the centred sign-in column. Colours come from the active theme's
 * `--theme-star-*` tokens, so a light theme draws dark stars instead of white
 * ones, and the animation is skipped for users who ask for reduced motion.
 */
export function Starfield({ density = 0 }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const styles = getComputedStyle(canvas);
    const themeColor = (name: string, fallback: string) =>
      styles.getPropertyValue(`--theme-${name}`).trim() || fallback;
    const colors = {
      dim: themeColor('star-dim', 'rgba(255,255,255,0.22)'),
      star: themeColor('star', 'rgba(255,255,255,0.45)'),
      bright: themeColor('star-bright', 'rgba(255,255,255,0.85)'),
      // the streak stays in the same colour family as the stars, just brighter
      trail: themeColor('star-trail', 'rgba(255,255,255,0.12)'),
      trailMid: themeColor('star-trail-mid', 'rgba(255,255,255,0.3)'),
      trailHead: themeColor('star-trail-head', 'rgba(255,255,255,0.65)'),
    };

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cols = 0;
    let rows = 0;
    let dpr = 1;
    const glyphs = { dim: ['.', '·'], star: ['·', '+'], bright: ['*', '✦'] };
    let stars: { x: number; y: number; ch: string; tone: keyof typeof colors }[] = [];
    let meteors: Meteor[] = [];
    let frame = 0;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      cols = Math.max(20, Math.floor(width / CELL_W));
      rows = Math.max(10, Math.floor(height / CELL_H));

      const count = Math.floor(cols * rows * (0.018 + density * 0.02));
      stars = Array.from({ length: count }, () => {
        const roll = Math.random();
        if (roll < 0.6) return { x: randomInt(cols), y: randomInt(rows), ch: pick(glyphs.dim), tone: 'dim' as const };
        if (roll < 0.9) return { x: randomInt(cols), y: randomInt(rows), ch: pick(glyphs.star), tone: 'star' as const };
        return { x: randomInt(cols), y: randomInt(rows), ch: pick(glyphs.bright), tone: 'bright' as const };
      });

      meteors = Array.from({ length: 5 + Math.floor(Math.random() * 3) }, (_, index) => makeMeteor(-index * 9));
    };

    const makeMeteor = (offsetY = 0): Meteor => {
      const speed = 0.14 + Math.random() * 0.12;
      const angle = 0.5 + Math.random() * 0.4;
      return {
        // start spread across the upper half so one is usually already in view
        x: Math.random() * cols - cols * 0.1,
        y: -Math.random() * rows * 0.35 - 2 + offsetY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        trail: 9 + Math.floor(Math.random() * 8),
        life: 0,
        maxLife: 320 + Math.random() * 220,
      };
    };

    const draw = () => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      context.font = `13px ui-monospace, 'SFMono-Regular', Menlo, monospace`;
      context.textBaseline = 'middle';

      context.globalAlpha = 1;
      for (const star of stars) {
        context.fillStyle = colors[star.tone];
        context.fillText(star.ch, star.x * CELL_W + 2, star.y * CELL_H + CELL_H / 2);
      }

      for (const meteor of meteors) {
        context.globalAlpha = 1;
        for (let step = meteor.trail; step >= 0; step--) {
          const x = Math.round(meteor.x - meteor.vx * step * 2.4);
          const y = Math.round(meteor.y - meteor.vy * step * 2.4);
          if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
          const lead = step === 0;
          // fade the tail so the streak reads as motion instead of stray stars
          context.globalAlpha = lead ? 1 : Math.max(0.08, 1 - step / (meteor.trail + 1));
          context.fillStyle = lead ? colors.trailHead : step < 3 ? colors.trailMid : colors.trail;
          context.fillText(lead ? '*' : step < 3 ? '─' : '·', x * CELL_W + 2, y * CELL_H + CELL_H / 2);
        }
      }
      context.globalAlpha = 1;
    };

    const step = () => {
      frame = requestAnimationFrame(step);
      draw();
    };

    const advance = () => {
      for (let index = 0; index < meteors.length; index++) {
        const meteor = meteors[index]!;
        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life++;
        if (meteor.y > rows + 6 || meteor.x > cols + 10 || meteor.life > meteor.maxLife) {
          meteors[index] = makeMeteor();
        }
      }
    };

    resize();
    draw();

    if (reduced) {
      // one static frame is enough: no animation for motion-sensitive users
      const onResize = () => {
        resize();
        draw();
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const timer = window.setInterval(advance, 90);
    const onResize = () => {
      resize();
      draw();
    };
    window.addEventListener('resize', onResize);
    step();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, [density]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 size-full"
      style={{
        ['--star-dim' as string]: 'color-mix(in srgb, var(--color-normal) 38%, transparent)',
        ['--star' as string]: 'color-mix(in srgb, var(--color-heading) 55%, transparent)',
        ['--star-bright' as string]: 'color-mix(in srgb, var(--color-heading) 95%, transparent)',
        ['--star-trail' as string]: 'color-mix(in srgb, var(--color-normal) 26%, transparent)',
        ['--star-trail-mid' as string]: 'color-mix(in srgb, var(--color-heading) 40%, transparent)',
        ['--star-trail-head' as string]: 'color-mix(in srgb, var(--color-heading) 75%, transparent)',
      }}
      aria-hidden
    />
  );
}

function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

function pick<T>(list: readonly T[]): T {
  return list[randomInt(list.length)]!;
}
