import type { PublicUser } from '@phanteon/shared';
import { memberColor, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { cn } from '../../lib/cn';

interface MemberNameProps {
  user: Pick<PublicUser, 'id' | 'displayName' | 'accentColor'>;
  guildId?: string | null;
  className?: string;
  /** Clicking the name opens the profile card, like Discord. */
  clickable?: boolean;
}

/** Displays a member name tinted with their highest coloured role. */
export function MemberName({ user, guildId, className, clickable }: MemberNameProps) {
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const openUserProfile = useUiStore((state) => state.openUserProfile);
  const color = guildId ? memberColor(guild, user.id, user.accentColor) : user.accentColor;

  if (!clickable) {
    return (
      <span className={cn('font-medium', className)} style={{ color }}>
        {user.displayName}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => openUserProfile(user.id, guildId ?? undefined, { x: event.clientX, y: event.clientY }, event.currentTarget)}
      className={cn('font-medium hover:underline', className)}
      style={{ color }}
    >
      {user.displayName}
    </button>
  );
}
