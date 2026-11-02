import { useEffect, useState } from 'react';
import { Copy, Mic, MicOff, PhoneOff, UserRound } from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { useAuthStore } from '../../app/stores/auth';
import { useUiStore } from '../../app/stores/ui';
import { useChatStore } from '../../app/stores/chat';
import { api } from '../../lib/api';
import {
  ContextMenuLabel,
  ContextMenuRow,
  ContextMenuSeparator,
  ContextMenuSurface,
} from '../../components/ui/ContextMenu';
import { toast } from '../../components/ui/Toast';

/**
 * Actions for a person in a call, opened by right-clicking their card. It uses
 * the same surface and item styling as every other context menu; the popover is
 * only the frame, so the volume slider can be dragged without closing it.
 */
export function CallPersonMenu() {
  const menu = useUiStore((state) => state.personMenu);
  const close = useUiStore((state) => state.closePersonMenu);
  const [gain, setGain] = useState(menu?.gain ?? 1);
  useEffect(() => setGain(menu?.gain ?? 1), [menu]);
  if (!menu) return null;

  const { state, guildId } = menu;
  const me = useAuthStore.getState().user?.id;
  const isMe = state.user.id === me;

  const run = (action: 'serverMute' | 'disconnect') => {
    void api.voice
      .moderate(guildId, state.user.id, action)
      .then(() => {
        toast.success(action === 'disconnect' ? 'Desconectado da chamada' : 'Microfone controlado', state.user.displayName);
      })
      .catch((error: unknown) => {
        toast.error('Não foi possível aplicar a ação', error instanceof Error ? error.message : undefined);
      });
    close();
  };

  return (
    <PopoverPrimitive.Root open>
      {/* the anchor sits exactly where the user right-clicked, so the menu opens under the pointer */}
      <PopoverPrimitive.Anchor
        style={{ position: 'fixed', left: menu.at.x, top: menu.at.y, width: 0, height: 0 }}
        aria-hidden
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className="z-[90] outline-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={close}
          onEscapeKeyDown={close}
        >
          {/* the menu surface and items are the shared context-menu components, not a second design */}
          <ContextMenuSurface className="w-[250px]">
            <ContextMenuLabel>{state.user.displayName}</ContextMenuLabel>

            {!isMe ? (
              <div className="px-2 py-2" onPointerDown={(event) => event.stopPropagation()}>
                <div className="mb-1.5 text-[11px] font-medium text-muted">
                  Volume de {state.user.displayName}
                </div>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={Math.round(gain * 100)}
                  aria-label={`Volume de ${state.user.displayName}`}
                  onChange={(event) => {
                    const nextGain = Number(event.currentTarget.value) / 100;
                    setGain(nextGain);
                    menu.onVolume(nextGain);
                  }}
                  className="block h-4 w-full cursor-pointer touch-none accent-[var(--color-brand)]"
                />
              </div>
            ) : null}

            <ContextMenuRow icon={<UserRound size={14} />} onSelect={() => { menu.onProfile(); close(); }}>
              Ver perfil
            </ContextMenuRow>
            <ContextMenuRow
              icon={<Copy size={14} />}
              onSelect={() => {
                void navigator.clipboard.writeText(state.user.id).catch(() => undefined);
                close();
              }}
            >
              Copiar ID do usuário
            </ContextMenuRow>

            {isMe ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuRow
                  variant="danger"
                  icon={<PhoneOff size={14} />}
                  onSelect={() => {
                    void useChatStore.getState().leaveVoice();
                    close();
                  }}
                >
                  Sair da chamada
                </ContextMenuRow>
              </>
            ) : menu.canModerate ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuRow
                  icon={state.serverMute ? <Mic size={14} /> : <MicOff size={14} />}
                  onSelect={() => run('serverMute')}
                >
                  {state.serverMute ? 'Remover silêncio do servidor' : 'Silenciar para todos'}
                </ContextMenuRow>
                <ContextMenuRow variant="danger" icon={<PhoneOff size={14} />} onSelect={() => run('disconnect')}>
                  Desconectar da chamada
                </ContextMenuRow>
              </>
            ) : null}
          </ContextMenuSurface>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
