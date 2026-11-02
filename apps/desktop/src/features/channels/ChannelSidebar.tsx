import type { Channel, GuildWithDetails } from '@phanteon/shared';
import {
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Folder,
  FolderInput,
  FolderPlus,
  Hash,
  LayoutList,
  Link2,
  Lock,
  Settings2,
  Trash2,
  Volume2,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Permission } from '@phanteon/shared';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useUiStore } from '../../app/stores/ui';
import { useNotificationStore } from '../../app/stores/notifications';
import { toast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import { api } from '../../lib/api';
import { GuildHeaderMenu } from '../guilds/GuildHeaderMenu';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { VoiceParticipants } from '../voice/VoiceParticipants';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu';

interface ChannelSidebarProps {
  guildId: string;
}

type DropTarget =
  | { kind: 'channel'; id: string; after: boolean }
  | { kind: 'category'; id: string }
  | { kind: 'top' };

interface ChannelSection {
  /** `null` for the channels that sit above every category. */
  category: Channel | null;
  channels: Channel[];
}

/**
 * The flat channel list is ordered so that every category is followed by its
 * own channels; this turns it into the groups the sidebar renders.
 */
function groupChannels(channels: Channel[]): ChannelSection[] {
  const categories = channels.filter((channel) => channel.type === 'category');
  const sections: ChannelSection[] = [];
  const loose = channels.filter((channel) => channel.type !== 'category' && !channel.categoryId);
  if (loose.length > 0) sections.push({ category: null, channels: loose });
  for (const category of categories) {
    sections.push({
      category,
      channels: channels.filter((channel) => channel.type !== 'category' && channel.categoryId === category.id),
    });
  }
  // a channel pointing at a category the viewer cannot see still has to show up
  const orphans = channels.filter(
    (channel) =>
      channel.type !== 'category' &&
      channel.categoryId &&
      !categories.some((category) => category.id === channel.categoryId),
  );
  if (orphans.length > 0) sections.push({ category: null, channels: orphans });
  return sections;
}

export function ChannelSidebar({ guildId }: ChannelSidebarProps) {
  const { channelId } = useParams();
  const guild = useChatStore((state) => state.guildDetails[guildId]);
  const loadGuild = useChatStore((state) => state.loadGuild);
  const online = useChatStore((state) => state.online);
  const setChannelInGuild = useChatStore((state) => state.setChannelInGuild);
  const removeChannelFromGuild = useChatStore((state) => state.removeChannelFromGuild);
  const mutedChannels = useNotificationStore((state) => state.prefs.mutedChannels);
  const toggleMutedChannel = useNotificationStore((state) => state.toggleMutedChannel);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  // the drop handler runs in the same tick as dragend, so the state may already be stale
  const draggedRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  useEffect(() => {
    void loadGuild(guildId);
  }, [guildId, loadGuild]);

  const sections = useMemo(() => (guild ? groupChannels(guild.channels) : []), [guild?.channels]);

  if (!guild) return <SidebarSkeleton />;

  const canManage = canInGuild(guild, Permission.ManageChannels);

  const toggleCollapsed = (id: string) =>
    setCollapsed((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  /** Moves a category among the others; its channels travel along. */
  const moveCategory = async (movingId: string, target: DropTarget) => {
    const categories = guild.channels.filter((channel) => channel.type === 'category');
    const moving = categories.find((category) => category.id === movingId);
    if (!moving) return;
    const others = categories.filter((category) => category.id !== movingId);

    if (target.kind === 'top') return persist([moving, ...others]);
    if (target.kind === 'category') {
      if (target.id === movingId) return;
      // dropping onto another category moves the dragged one to the end
      setCollapsed((current) => current.filter((id) => id !== target.id));
      return persist([...others, moving]);
    }
    const anchorIndex = others.findIndex((category) => category.id === target.id);
    if (anchorIndex < 0) return;
    others.splice(anchorIndex + (target.after ? 1 : 0), 0, moving);
    return persist(others);
  };

  /** Rebuilds the flat list with the dragged channel in its new home. */
  const move = async (movingId: string, target: DropTarget) => {
    if (guild.channels.some((channel) => channel.id === movingId && channel.type === 'category')) {
      return moveCategory(movingId, target);
    }

    const categories = guild.channels.filter((channel) => channel.type === 'category');
    const ordered = guild.channels.filter((channel) => channel.type !== 'category');
    const moving = ordered.find((channel) => channel.id === movingId);
    if (!moving || (target.kind === 'channel' && target.id === movingId) || (target.kind === 'category' && target.id === movingId)) {
      return;
    }

    const rest = ordered.filter((channel) => channel.id !== movingId);
    let categoryId = moving.categoryId;
    let insertAt = rest.length;

    if (target.kind === 'top') {
      categoryId = null;
      insertAt = 0;
    } else if (target.kind === 'category') {
      categoryId = target.id;
      // join the end of that category's channels
      const positions = rest.map((channel) => channel.categoryId);
      const last = positions.lastIndexOf(target.id);
      insertAt = last >= 0 ? last + 1 : 0;
      setCollapsed((current) => current.filter((id) => id !== target.id));
    } else {
      const anchor = rest.findIndex((channel) => channel.id === target.id);
      if (anchor < 0) return;
      categoryId = rest[anchor]!.categoryId;
      insertAt = anchor + (target.after ? 1 : 0);
    }

    const next = [...rest];
    next.splice(insertAt, 0, { ...moving, categoryId });
    return persist(categories, next);
  };

  /** Writes the flat list: loose channels first, then every category followed by its channels. */
  const persist = async (categories: Channel[], others = guild.channels.filter((channel) => channel.type !== 'category')) => {
    const flat = others.filter((channel) => !channel.categoryId);
    for (const category of categories) {
      flat.push(category, ...others.filter((channel) => channel.categoryId === category.id));
    }
    const known = new Set(flat.map((channel) => channel.id));
    flat.push(...others.filter((channel) => !known.has(channel.id)));

    try {
      const { channels } = await api.guilds.reorderChannels(
        guild.id,
        flat.map((channel) => ({ id: channel.id, categoryId: channel.categoryId ?? null })),
      );
      for (const channel of channels) setChannelInGuild(guild.id, channel);
    } catch (error) {
      toast.error('Não foi possível mover', error instanceof Error ? error.message : undefined);
    }
  };

  const dropOn = (event: DragEvent, target: DropTarget) => {
    if (!dragId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(target);
  };

  const finishDrop = (target: DropTarget) => {
    const moving = draggedRef.current;
    draggedRef.current = null;
    if (moving) void move(moving, target);
    setDragId(null);
    setDropTarget(null);
  };

  /** A drop that aimed at nothing in particular: keep the channel where it was. */
  const cancelDrop = (event: DragEvent) => {
    if (!dragId) return;
    event.preventDefault();
    event.stopPropagation();
    draggedRef.current = null;
    setDragId(null);
    setDropTarget(null);
  };

  const dragProps = (channel: Channel) => ({
    draggable: canManage,
    onDragStart: (event: DragEvent) => {
      if (!canManage) return;
      draggedRef.current = channel.id;
      setDragId(channel.id);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', channel.id);
    },
    // the source is the nearest drop zone, so a sloppy drop never reaches the list "top"
    // zone (which would un-group the channel); a precise row/header drop stops it first
    onDrop: (event: DragEvent) => cancelDrop(event),
    onDragEnd: () => {
      draggedRef.current = null;
      setDragId(null);
      setDropTarget(null);
    },
  });

  const isDropping = (target: DropTarget) => {
    if (!dropTarget) return false;
    if (dropTarget.kind !== target.kind) return false;
    if (dropTarget.kind === 'top') return true;
    if (target.kind === 'top') return false;
    return dropTarget.id === target.id && (dropTarget.kind !== 'channel' || dropTarget.after === (target as { after: boolean }).after);
  };

  const openChannelSettings = (id: string) => openModal({ kind: 'channel-settings', guildId, channelId: id });

  /** Reorders within the flat list the server keeps: the channel moves one channel neighbour up/down. */
  const shiftChannel = async (channel: Channel, direction: -1 | 1) => {
    const others = guild.channels.filter((item) => item.type !== 'category');
    const index = others.findIndex((item) => item.id === channel.id);
    const neighbour = index + direction;
    if (index < 0 || neighbour < 0 || neighbour >= others.length) return;
    const rest = others.filter((item) => item.id !== channel.id);
    const next = [...rest];
    next.splice(neighbour, 0, channel);
    return persist(guild.channels.filter((item) => item.type === 'category'), next);
  };

  const shiftCategory = async (category: Channel, direction: -1 | 1) => {
    const categories = guild.channels.filter((item) => item.type === 'category');
    const index = categories.findIndex((item) => item.id === category.id);
    const neighbour = index + direction;
    if (index < 0 || neighbour < 0 || neighbour >= categories.length) return;
    const next = categories.filter((item) => item.id !== category.id);
    next.splice(neighbour, 0, category);
    return persist(next);
  };

  const channelsOf = (categoryId: string | null) =>
    guild.channels.filter((channel) => channel.type !== 'category' && (channel.categoryId ?? null) === categoryId);

  const moveTargets = (channel: Channel) => (
    <ContextMenuSub>
      <ContextMenuSubTrigger icon={<FolderInput size={14} aria-hidden />}>Mover para</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem disabled={channel.categoryId === null} onSelect={() => void move(channel.id, { kind: 'top' })} icon={<LayoutList size={14} aria-hidden />}>
          Sem categoria
        </ContextMenuItem>
        <ContextMenuSeparator />
        {guild.channels
          .filter((item) => item.type === 'category' && item.id !== channel.categoryId)
          .map((category) => (
            <ContextMenuItem key={category.id} onSelect={() => void move(channel.id, { kind: 'category', id: category.id })} icon={<Folder size={14} aria-hidden />}>
              {category.name}
            </ContextMenuItem>
          ))}
        {guild.channels.some((item) => item.type === 'category') ? null : (
          <ContextMenuItem disabled>Nenhuma categoria ainda</ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );

  const channelMenu = (channel: Channel) => (
    <ContextMenuContent>
      <ContextMenuLabel>{channel.type === 'voice' ? channel.name : `#${channel.name}`}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => navigate(`/app/${guildId}/${channel.id}`)} icon={<ExternalLink size={14} aria-hidden />}>
        Abrir
      </ContextMenuItem>
      <ContextMenuItem
        icon={mutedChannels.includes(channel.id) ? <BellOff size={14} aria-hidden /> : <Bell size={14} aria-hidden />}
        onSelect={() => toggleMutedChannel(channel.id)}
      >
        {mutedChannels.includes(channel.id) ? 'Ativar notificações' : 'Silenciar canal'}
      </ContextMenuItem>
      <ContextMenuItem
        icon={<Link2 size={14} aria-hidden />}
        onSelect={() => {
          void navigator.clipboard.writeText(`#${channel.name}`).catch(() => undefined);
        }}
      >
        Copiar nome do canal
      </ContextMenuItem>
      {canManage ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'text', categoryId: channel.categoryId ?? null })} icon={<Hash size={14} aria-hidden />}>
            Criar canal aqui
          </ContextMenuItem>
          {moveTargets(channel)}
          <ContextMenuItem onSelect={() => void shiftChannel(channel, -1)} icon={<ChevronUp size={14} aria-hidden />}>
            Mover para cima
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void shiftChannel(channel, 1)} icon={<ChevronDown size={14} aria-hidden />}>
            Mover para baixo
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openChannelSettings(channel.id)} icon={<Settings2 size={14} aria-hidden />}>
            Configurações do canal
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="danger"
            icon={<Trash2 size={14} aria-hidden />}
            onSelect={() => {
              openModal({
                kind: 'confirm',
                title: 'Excluir canal',
                description: `Excluir #${channel.name}? Todas as mensagens serão removidas permanentemente.`,
                confirmLabel: 'Excluir canal',
                onConfirm: async () => {
                  await api.channels.remove(channel.id);
                  removeChannelFromGuild(guildId, channel.id);
                },
              });
            }}
          >
            Excluir canal
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );

  const categoryMenu = (category: Channel) => (
    <ContextMenuContent>
      <ContextMenuLabel>{category.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => toggleCollapsed(category.id)} icon={<ChevronDown size={14} aria-hidden />}>
        {collapsed.includes(category.id) ? 'Expandir categoria' : 'Recolher categoria'}
      </ContextMenuItem>
      {canManage ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'text', categoryId: category.id })} icon={<Hash size={14} aria-hidden />}>
            Criar canal de texto
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'voice', categoryId: category.id })} icon={<Volume2 size={14} aria-hidden />}>
            Criar canal de voz
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-category', guildId })} icon={<FolderPlus size={14} aria-hidden />}>
            Criar categoria
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void shiftCategory(category, -1)} icon={<ChevronUp size={14} aria-hidden />}>
            Mover categoria para cima
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void shiftCategory(category, 1)} icon={<ChevronDown size={14} aria-hidden />}>
            Mover categoria para baixo
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openChannelSettings(category.id)} icon={<Settings2 size={14} aria-hidden />}>
            Configurações da categoria
          </ContextMenuItem>
          <ContextMenuItem
            variant="danger"
            icon={<Trash2 size={14} aria-hidden />}
            onSelect={() => {
              openModal({
                kind: 'confirm',
                title: 'Excluir categoria',
                description: `Excluir "${category.name}"? Os canais continuam existindo e vão para o topo da lista.`,
                confirmLabel: 'Excluir categoria',
                onConfirm: async () => {
                  await api.guilds.removeCategory(guildId, category.id);
                  removeChannelFromGuild(guildId, category.id);
                },
              });
            }}
          >
            Excluir categoria
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );

  /** Right-click on empty space: everything needed to build the list from scratch. */
  const blankMenu = (
    <ContextMenuContent>
      <ContextMenuLabel>{guild.name}</ContextMenuLabel>
      {canManage ? (
        <>
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-category', guildId })} icon={<FolderPlus size={14} aria-hidden />}>
            Criar categoria
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'text', categoryId: null })} icon={<Hash size={14} aria-hidden />}>
            Criar canal de texto
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'voice', categoryId: null })} icon={<Volume2 size={14} aria-hidden />}>
            Criar canal de voz
          </ContextMenuItem>
        </>
      ) : null}
      {canManage ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openModal({ kind: 'guild-settings', guildId, section: 'channels' })} icon={<Settings2 size={14} aria-hidden />}>
            Gerenciar canais e categorias
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-divider bg-sidebar" aria-label="Canais do servidor">
      <GuildHeaderMenu guild={guild} />

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ScrollArea
            className="flex-1"
            viewportClassName="px-2 pb-24 pt-1"
            onDragOver={(event) => dragId && event.preventDefault()}
            onDrop={() => finishDrop({ kind: 'top' })}
          >
            <div
              className={cn('h-2 rounded-xs transition-colors', dragId && isDropping({ kind: 'top' }) && 'bg-brand/40')}
              onDragOver={(event) => dropOn(event, { kind: 'top' })}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                finishDrop({ kind: 'top' });
              }}
            />

            {sections.map((section) => (
              <Fragment key={section.category?.id ?? section.channels[0]?.id ?? 'loose'}>
                {section.category ? (
                  <>
                    <ContextMenu key={`menu-${section.category.id}`}>
                      <ContextMenuTrigger asChild>
                        <CategoryHeader
                          category={section.category}
                          collapsed={collapsed.includes(section.category.id)}
                          onToggle={() => toggleCollapsed(section.category!.id)}
                          dragging={dragId === section.category.id}
                          dragProps={{
                            draggable: canManage,
                            onDragStart: (event) => {
                              if (!canManage) return;
                              draggedRef.current = section.category!.id;
                              setDragId(section.category!.id);
                              event.dataTransfer.effectAllowed = 'move';
                            },
                            onDragEnd: () => {
                              draggedRef.current = null;
                              setDragId(null);
                              setDropTarget(null);
                            },
                          }}
                          dropActive={!dragId && Boolean(dropTarget?.kind === 'category' && dropTarget.id === section.category.id)}
                          onDragOver={(event) => dropOn(event, { kind: 'category', id: section.category!.id })}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (section.category) finishDrop({ kind: 'category', id: section.category.id });
                          }}
                        />
                      </ContextMenuTrigger>
                      {categoryMenu(section.category)}
                    </ContextMenu>
                  </>
                ) : section.channels.length > 0 ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div className="flex items-center px-1 pb-0.5 pt-2">
                        <span className="truncate text-[11px] font-bold uppercase tracking-wide text-muted">Sem categoria</span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuLabel>Sem categoria</ContextMenuLabel>
                      <ContextMenuItem onSelect={() => openModal({ kind: 'create-category', guildId })} icon={<FolderPlus size={14} aria-hidden />}>
                        Criar categoria
                      </ContextMenuItem>
                      {canManage ? (
                        <>
                          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'text', categoryId: null })} icon={<Hash size={14} aria-hidden />}>
                            Criar canal de texto
                          </ContextMenuItem>
                          <ContextMenuItem onSelect={() => openModal({ kind: 'create-channel', guildId, type: 'voice', categoryId: null })} icon={<Volume2 size={14} aria-hidden />}>
                            Criar canal de voz
                          </ContextMenuItem>
                        </>
                      ) : null}
                    </ContextMenuContent>
                  </ContextMenu>
                ) : null}

                <ul
                  className={cn('flex flex-col gap-0.5', section.category && collapsed.includes(section.category.id) && 'hidden')}
                  onDragOver={(event) => dragId && event.preventDefault()}
                  onDrop={(event) => {
                    if (section.category) {
                      event.preventDefault();
                      finishDrop({ kind: 'category', id: section.category.id });
                    }
                  }}
                >
                  {section.channels.map((channel) => (
                    <ChannelRow
                      key={channel.id}
                      channel={channel}
                      guildId={guild.id}
                      active={channel.id === channelId}
                      dragging={dragId === channel.id}
                      dropBefore={isDropping({ kind: 'channel', id: channel.id, after: false })}
                      dropAfter={isDropping({ kind: 'channel', id: channel.id, after: true })}
                      muted={mutedChannels.includes(channel.id)}
                      dragProps={dragProps(channel)}

                      menu={channelMenu(channel)}
                      onDragOver={(event) => {
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        const after = event.clientY > rect.top + rect.height / 2;
                        dropOn(event, { kind: 'channel', id: channel.id, after });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        const after = event.clientY > rect.top + rect.height / 2;
                        finishDrop({ kind: 'channel', id: channel.id, after });
                      }}
                    />
                  ))}
                </ul>

                {section.channels.length === 0 && !section.category ? (
                  <p className="px-2 py-3 text-[12px] text-faint">Nenhum canal ainda. Clique com o botão direito para criar.</p>
                ) : null}
              </Fragment>
            ))}

            <div className="min-h-16" aria-hidden />
          </ScrollArea>
        </ContextMenuTrigger>
        {blankMenu}
      </ContextMenu>
    </aside>
  );
}

function CategoryHeader({
  onContextMenu,
  category,
  collapsed,
  onToggle,
  dragging,
  dragProps,
  dropActive,
  onDragOver,
  onDrop,
}: {
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  category: Channel;
  dragging: boolean;
  dragProps: { draggable: boolean; onDragStart: (event: DragEvent) => void; onDragEnd: () => void };
  collapsed: boolean;
  onToggle: () => void;
  dropActive: boolean;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}) {
  return (
    <div
      className={cn(
        'mt-3 flex items-center rounded-sm px-1 pb-0.5 pt-2 transition-colors',
        dropActive && 'bg-brand/15',
        dragging && 'opacity-40',
      )}
      onDragOver={(event) => {
        // a channel dropped on the header lands right after the category's first channel
        onDragOver(event);
        event.stopPropagation();
      }}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      {...dragProps}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-bold uppercase tracking-wide text-muted hover:text-normal"
      >
        <ChevronDown size={12} className={cn('shrink-0 transition-transform', collapsed && '-rotate-90')} aria-hidden />
        {category.private ? <Lock size={10} className="shrink-0 text-warn" aria-label="Categoria privada" /> : null}
        <span className="truncate">{category.name}</span>
      </button>
    </div>
  );
}

function ChannelRow({
  onContextMenu,
  channel,
  guildId,
  active,
  dragging,
  dropBefore,
  dropAfter,
  muted,
  dragProps,
  menu,
  onDragOver,
  onDrop,
}: {
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  channel: Channel;
  guildId: string;
  active: boolean;
  dragging: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  muted: boolean;
  dragProps: {
    draggable: boolean;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
  };
  menu: React.ReactNode;
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
}) {
  const unread = useNotificationStore((state) => state.unread[channel.id] ?? 0);
  const markChannelRead = useNotificationStore((state) => state.markChannelRead);
  const isVoice = channel.type === 'voice';
  const Icon = isVoice ? Volume2 : Hash;

  useEffect(() => {
    if (active) markChannelRead(channel.id);
  }, [active, channel.id, markChannelRead]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          className={cn(
            'group relative flex flex-wrap items-center',
            dragging && 'opacity-40',
            (dropBefore || dropAfter) &&
              'before:pointer-events-none before:absolute before:inset-x-0 before:z-[2] before:h-[2px] before:rounded-full before:bg-brand after:pointer-events-none after:absolute after:inset-x-0 after:z-[2] after:h-[2px] after:rounded-full after:bg-brand',
            dropBefore ? 'before:top-0' : null,
            dropAfter ? 'after:bottom-0' : null,
          )}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onContextMenu={onContextMenu}
          {...dragProps}
        >
          <Link
            to={`/app/${guildId}/${channel.id}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-[6px] text-[15px] transition-colors',
              active ? 'bg-selected font-medium text-heading' : 'text-muted hover:bg-hover hover:text-normal',
              !active && unread > 0 && 'font-semibold text-heading',
              !active && unread > 0 && muted && 'opacity-60',
            )}
          >
            <Icon size={16} className="shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {channel.private ? (
              <Lock size={11} className="shrink-0 text-faint" aria-label="Canal privado" />
            ) : null}
            {!active && unread > 0 ? (
              muted ? (
                <span className="size-1.5 shrink-0 rounded-full bg-faint" aria-label="Notificações silenciadas" />
              ) : (
                <span
                  className="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-red px-1 text-[10px] font-bold leading-4 text-on-brand"
                  aria-label={`${unread} não lidas`}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )
            ) : null}
            {isVoice && channel.userLimit > 0 ? (
              <span className="shrink-0 text-[11px] tabular-nums">{channel.userLimit}</span>
            ) : null}
          </Link>
          {isVoice ? (
            <div className="w-full">
              <VoiceParticipants guildId={guildId} channelId={channel.id} />
            </div>
          ) : null}
        </li>
      </ContextMenuTrigger>
      {menu}
    </ContextMenu>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-2 border-r border-divider bg-sidebar p-3" aria-busy>
      <div className="h-8 animate-pulse rounded bg-hover" />
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="h-6 animate-pulse rounded bg-hover"
          style={{ width: `${70 + ((index * 7) % 25)}%` }}
        />
      ))}
    </aside>
  );
}
