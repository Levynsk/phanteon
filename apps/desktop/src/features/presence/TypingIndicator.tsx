import type { TypingEntry } from '../../app/stores/chat';

export function TypingIndicator({ entries }: { entries: TypingEntry[] }) {
  if (entries.length === 0) return <div className="h-4" aria-live="polite" />;

  const names = entries.slice(0, 3).map((entry) => entry.user.displayName);
  const label =
    names.length === 1
      ? `${names[0]} está digitando…`
      : names.length === 2
        ? `${names[0]} e ${names[1]} estão digitando…`
        : `Várias pessoas estão digitando…`;

  return (
    <div className="flex h-4 items-center gap-1.5 text-[12px] font-medium text-normal" aria-live="polite">
      {/* fixed-size box: the bouncing dots animate inside it instead of nudging the row */}
      <span className="flex size-3 shrink-0 items-center justify-center gap-0.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="inline-block size-1 rounded-full bg-current"
            style={{ animation: 'presence-typing 1.2s infinite', animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}
