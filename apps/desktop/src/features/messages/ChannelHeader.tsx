import type { Channel } from '@phanteon/shared';
import { AtSign, Bell, BellOff, CheckCheck, Hash, Link2, Search, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Message } from '@phanteon/shared';
import { api } from '../../lib/api';
import { useUiStore } from '../../app/stores/ui';
import { useNotificationStore } from '../../app/stores/notifications';
import { toast } from '../../components/ui/Toast';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../components/ui/ContextMenu';
import { IconButton } from '../../components/ui/IconButton';
import { Input } from '../../components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/Popover';
import { ScrollArea } from '../../components/ui/ScrollArea';
import { MessageContent } from './MessageContent';

interface ChannelHeaderProps {
  channel: Channel;
  isGuild: boolean;
  dmWith?: string;
  /** Opens the profile card of the other side of a DM. */
  dmUserId?: string;
  onJumpToMessage: (messageId: string) => void;
}

export function ChannelHeader({ channel, isGuild, dmWith, dmUserId, onJumpToMessage }: ChannelHeaderProps) {
  const memberListOpen = useUiStore((state) => state.memberListOpen);
  const toggleMemberList = useUiStore((state) => state.toggleMemberList);
  const openUserProfile = useUiStore((state) => state.openUserProfile);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const markChannelRead = useNotificationStore((state) => state.markChannelRead);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.channels.searchMessages(channel.id, { query: term, limit: 30 }).then(
        ({ messages }) => {
          if (active) setResults(messages);
        },
        () => {
          if (active) setResults([]);
        },
      ).finally(() => {
        if (active) setSearching(false);
      });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [channel.id, query]);

  const Icon = isGuild ? Hash : AtSign;

  const muted = useNotificationStore((state) => state.prefs.mutedChannels.includes(channel.id));
  const setPrefs = useNotificationStore((state) => state.setPrefs);
  const toggleMuted = () => {
    const current = useNotificationStore.getState().prefs.mutedChannels;
    setPrefs({
      mutedChannels: muted ? current.filter((id) => id !== channel.id) : [...current, channel.id],
    });
  };
  const copyName = () => {
    void navigator.clipboard
      .writeText(`#${channel.name}`)
      .then(() => toast.success('Nome do canal copiado'))
      .catch(() => toast.error('Não foi possível copiar'));
  };

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <header className="relative flex h-12 shrink-0 items-center gap-2 px-4 border-b border-line shadow-[inset_0_-1px_0_var(--color-divider)]">
      <Icon size={20} className="shrink-0 text-muted" aria-hidden />
      {dmUserId ? (
        <button
          type="button"
          onClick={(event) => openUserProfile(dmUserId, undefined, { x: event.clientX, y: event.clientY }, event.currentTarget)}
          className="truncate text-base font-semibold text-heading transition-colors hover:text-brand"
        >
          {dmWith ?? channel.name}
        </button>
      ) : (
        <h1 className="truncate text-base font-semibold text-heading">{dmWith ?? channel.name}</h1>
      )}
      {channel.topic ? (
        <>
          <span className="mx-1 hidden h-6 w-px bg-divider lg:block" aria-hidden />
          {/* the topic tears into one truncated line instead of squeezing the channel name out */}
          <span className="hidden min-w-0 flex-1 truncate whitespace-nowrap text-[13px] text-muted lg:block">
            {channel.topic}
          </span>
        </>
      ) : null}

      <div className="ml-auto flex items-center gap-1">
        <Popover
          open={searchOpen}
          onOpenChange={(open) => {
            setSearchOpen(open);
            if (!open) setQuery('');
          }}
        >
          <PopoverTrigger asChild>
            <span className="inline-flex">
              <IconButton icon={Search} label="Buscar mensagens" active={searchOpen} />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-[420px] p-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
              <Input
                autoFocus
                size="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar no canal"
                aria-label="Buscar mensagens neste canal"
                className="pl-8"
              />
            </div>
            <ScrollArea className="mt-2 max-h-[320px]">
              {query.trim() === '' ? (
                <p className="px-2 py-4 text-center text-xs text-muted">Digite algo para buscar neste canal.</p>
              ) : searching ? (
                <p className="px-2 py-4 text-center text-xs text-muted">Buscando mensagens…</p>
              ) : results.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted">Nenhum resultado para “{query}”.</p>
              ) : (
                <ul className="flex flex-col">
                  {results.map((message) => (
                    <li key={message.id}>
                      <button
                        type="button"
                        className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-hover"
                        onClick={() => {
                          onJumpToMessage(message.id);
                          setSearchOpen(false);
                          setQuery('');
                        }}
                      >
                        <span className="text-xs font-semibold" style={{ color: message.author.accentColor }}>
                          {message.author.displayName}
                        </span>
                        <MessageContent content={message.content.slice(0, 240)} className="text-[13px]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-sm py-1 text-xs text-muted hover:text-normal"
              onClick={() => {
                setQuery('');
                setSearchOpen(false);
              }}
            >
              <X size={12} aria-hidden /> Fechar busca
            </button>
          </PopoverContent>
        </Popover>

        {isGuild ? (
          <IconButton icon={Users} label="Alternar lista de membros" active={memberListOpen} onClick={toggleMemberList}  />
        ) : null}
      </div>
    </header>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-[224px]">
      <ContextMenuItem icon={<Link2 size={14} />} onSelect={copyName}>
        Copiar nome do canal
      </ContextMenuItem>
      <ContextMenuItem icon={muted ? <Bell size={14} /> : <BellOff size={14} />} onSelect={toggleMuted}>
        {muted ? 'Ativar notificações' : 'Silenciar canal'}
      </ContextMenuItem>
      <ContextMenuItem icon={<CheckCheck size={14} />} onSelect={() => markChannelRead(channel.id)}>
        Marcar como lido
      </ContextMenuItem>
      {isGuild ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<Users size={14} />} onSelect={toggleMemberList}>
            {memberListOpen ? 'Ocultar lista de membros' : 'Mostrar lista de membros'}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
    </ContextMenu>
  );
}
