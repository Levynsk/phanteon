import { useState } from 'react';
import { Bell, BellOff, CheckCheck, Hash, MessageSquare, PhoneCall, Trash2, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotificationStore, type NotificationItem } from '../../app/stores/notifications';
import { useUiStore } from '../../app/stores/ui';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { cn } from '../../lib/cn';

const KIND_ICON = {
  message: Hash,
  mention: Bell,
  dm: MessageSquare,
  call: PhoneCall,
  friend: UserPlus,
  server: Hash,
} as const;

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** Bell in the title bar: unread dot, recent history and a shortcut to the settings. */
export function NotificationCenter() {
  const items = useNotificationStore((state) => state.items);
  const unread = useNotificationStore((state) => state.unread);
  const prefs = useNotificationStore((state) => state.prefs);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const markChannelRead = useNotificationStore((state) => state.markChannelRead);
  const remove = useNotificationStore((state) => state.remove);
  const clear = useNotificationStore((state) => state.clear);
  const openModal = useUiStore((state) => state.openModal);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const unreadChannels = Object.keys(unread).length;
  const badge = unreadChannels;

  const visit = (item: NotificationItem) => {
    if (item.channelId) markChannelRead(item.channelId);
    setOpen(false);
    if (item.channelId) navigate(item.guildId ? `/app/${item.guildId}/${item.channelId}` : `/app/dm/${item.channelId}`);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) markAllRead();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badge > 0 ? `Notificações (${badge} sem lidas)` : 'Notificações'}
          className="no-drag relative flex size-7 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover hover:text-heading"
        >
          {prefs.enabled ? <Bell size={15} aria-hidden /> : <BellOff size={15} aria-hidden />}
          {badge > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-red px-1 text-[9px] font-bold leading-3.5 text-on-brand">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-[380px] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <h2 className="text-sm font-semibold text-heading">Notificações</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-muted hover:bg-hover hover:text-heading"
            >
              <CheckCheck size={13} aria-hidden /> Marcar lidas
            </button>
            <button
              type="button"
              onClick={clear}
              className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-muted hover:bg-hover hover:text-heading"
            >
              <Trash2 size={13} aria-hidden /> Limpar
            </button>
          </div>
        </div>

        <div className="max-h-[380px] overflow-y-auto border-t border-divider">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              Tudo em dia. Menções, mensagens diretas e chamadas aparecem aqui.
            </p>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => {
                const Icon = KIND_ICON[item.kind];
                return (
                  <li key={item.id} className={cn('group/item flex items-start gap-2.5 px-3 py-2 hover:bg-hover', !item.read && 'bg-brand-soft/40')}>
                    <button type="button" onClick={() => visit(item)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-input text-muted">
                        <Icon size={13} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate text-[13px] font-semibold text-heading">{item.title}</span>
                          <span className="ml-auto shrink-0 text-[10px] text-faint">{relative(item.createdAt)}</span>
                        </span>
                        <span className="line-clamp-2 block text-[12px] text-muted">{item.body}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Remover notificação"
                      onClick={() => remove(item.id)}
                      className="mt-1 shrink-0 rounded-sm p-1 text-faint opacity-0 transition-opacity hover:text-heading group-hover/item:opacity-100"
                    >
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-divider p-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openModal({ kind: 'user-settings', section: 'notifications' });
            }}
            className="w-full rounded-sm px-2 py-1.5 text-[12px] font-medium text-link hover:bg-hover"
          >
            Configurações de notificação
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
