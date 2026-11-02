import { Headphones, Mic, MicOff, MonitorUp, Phone, PhoneOff, ScreenShareOff, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { toast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import { sharingScreen, startScreenShare, stopScreenShare } from '../../lib/voice-session';

/**
 * The call controls as one dock: call on the left, mic, sound, screen and
 * settings inside the same pill. No separators — the grouping comes from the
 * call button carrying the only strong fill while the call is up.
 */
export function CallDock({
  inCall,
  micMuted,
  deafened,
  canConnect = true,
  onToggleCall,
  onToggleMic,
  onToggleSound,
  onOpenVoiceSettings,
  variant = 'ghost',
  className,
}: {
  inCall: boolean;
  micMuted: boolean;
  deafened: boolean;
  canConnect?: boolean;
  onToggleCall: () => void;
  onToggleMic: () => void;
  onToggleSound: () => void;
  onOpenVoiceSettings: () => void;
  /** `ghost` sits on an existing panel; `floating` is its own surface over the app. */
  variant?: 'ghost' | 'floating';
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Controles da chamada"
      className={cn(
        // snug: the pill sits one gap away from the edge buttons on every side
        'pointer-events-auto flex w-fit items-center gap-1.5 p-1.5',
        variant === 'floating' && 'rounded-xl border border-divider bg-surface-alt shadow-elevated',
        className,
      )}
    >
      <button
        type="button"
        aria-label={inCall ? 'Sair da chamada' : 'Entrar na chamada'}
        title={inCall ? 'Sair da chamada' : 'Entrar na chamada'}
        disabled={!canConnect && !inCall}
        onClick={onToggleCall}
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-outline',
          inCall ? 'bg-red text-on-image hover:bg-red/85' : 'bg-brand text-on-brand hover:bg-brand-hover',
          !canConnect && !inCall && 'cursor-not-allowed opacity-40',
        )}
      >
        {/* a handset, not the sign-out arrow: this ends a call, it does not leave the account */}
        {inCall ? <PhoneOff size={18} aria-hidden /> : <Phone size={18} aria-hidden />}
      </button>

      <DockButton
        icon={micMuted ? MicOff : Mic}
        label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
        off={micMuted}
        disabled={!inCall}
        onClick={onToggleMic}
      />
      <DockButton
        icon={Headphones}
        label={deafened ? 'Ativar som' : 'Desativar som'}
        off={deafened}
        disabled={!inCall}
        onClick={onToggleSound}
      />
      <ScreenShareButton disabled={!inCall} />
      <DockButton
        icon={Settings}
        label="Configurações de voz"
        onClick={onOpenVoiceSettings}
      />
    </div>
  );
}

/** Sharing is a session concern, so the button reads its own state instead of asking the page. */
function ScreenShareButton({ disabled }: { disabled: boolean }) {
  const [sharing, setSharing] = useState(sharingScreen);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (sharing) {
        stopScreenShare();
        setSharing(false);
        return;
      }
      const { label, quality } = await startScreenShare();
      setSharing(true);
      // report what the OS actually delivered, not what was asked for
      const actual =
        quality.width && quality.height
          ? `${quality.height}p${quality.frameRate ? ` @ ${Math.round(quality.frameRate)} fps` : ''}`
          : '';
      if (label) toast.success(actual ? `Transmitindo em ${actual}` : `Transmitindo: ${label}`, actual ? label : undefined);
    } catch (error) {
      // passive cases: the picker was closed, or Electron had no screen to capture
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) return;
      toast.error('Falha ao compartilhar a tela', error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DockButton
      icon={sharing ? ScreenShareOff : MonitorUp}
      label={sharing ? 'Parar transmissão' : 'Transmitir tela'}
      active={sharing}
      disabled={disabled || busy}
      onClick={() => void toggle()}
    />
  );
}

/** Square icon button inside the dock. `off` means the control is muted/deafened. */
export function DockButton({
  icon: Icon,
  label,
  off = false,
  active = false,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  off?: boolean;
  active?: boolean;
} & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={off || active}
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-outline',
        // every control sits on its own fill, so the row reads as buttons, not icons floating on the pill
        !off && !active && 'bg-elevated text-muted hover:bg-active hover:text-heading',
        // "off" is the same red as every other muted indicator in the app
        off && 'bg-red/15 text-red hover:bg-red/25',
        active && 'bg-brand-soft text-brand hover:bg-brand/25',
      )}
      {...props}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
