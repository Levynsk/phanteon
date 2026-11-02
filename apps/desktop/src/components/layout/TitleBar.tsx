import { useUiStore } from '../../app/stores/ui';
import { useChatStore } from '../../app/stores/chat';
import { NotificationCenter } from './NotificationCenter';
import { CloseGlyph, MaximizeGlyph, MinimizeGlyph, RestoreGlyph, WindowButton } from './WindowControls';
import { useWindowMaximized } from '../../lib/useWindowMaximized';

const APP_NAME = 'Phanteon';

export function TitleBar() {
  const desktop = window.desktop;
  const isMac = desktop?.platform === 'darwin';
  const maximized = useWindowMaximized();
  const modal = useUiStore((state) => state.modal);
  const guildId = modal?.kind === 'guild-settings' ? modal.guildId : null;
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));

  const title = guild?.name ?? APP_NAME;

  return (
    <header
      className="drag-region relative flex h-9 shrink-0 items-center border-b border-divider bg-surface-alt"
      style={{ paddingLeft: isMac ? 78 : 12 }}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">{title}</div>

      <div className="no-drag ml-auto mr-2 flex items-center">
        <NotificationCenter />
      </div>

      {desktop && !isMac ? (
        <div className="no-drag flex h-full items-stretch">
          <WindowButton label="Minimizar" onClick={() => desktop.window.minimize()}>
            <MinimizeGlyph />
          </WindowButton>
          <WindowButton
            label={maximized ? 'Restaurar' : 'Maximizar'}
            onClick={() => desktop.window.toggleMaximize()}
          >
            {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
          </WindowButton>
          <WindowButton label="Fechar" danger onClick={() => desktop.window.close()}>
            <CloseGlyph />
          </WindowButton>
        </div>
      ) : null}
    </header>
  );
}
