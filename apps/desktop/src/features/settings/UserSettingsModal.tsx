import { currentToken } from '../../lib/api';
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, Check, Copy, Image, ImagePlus, LogOut, Palette, Play, ShieldCheck, Volume2, X } from 'lucide-react';
import type { PublicUser, UserStatus } from '@phanteon/shared';
import { DEFAULT_ACCENT_COLORS, USER_STATUSES } from '@phanteon/shared';
import { useAuthStore } from '../../app/stores/auth';
import { useChatStore } from '../../app/stores/chat';
import { useThemeStore, THEMES, type ThemeId } from '../../app/stores/theme';
import { Permission } from '@phanteon/shared';
import { useUiStore, type UserSettingsSection } from '../../app/stores/ui';
import { requestDesktopPermission, useNotificationStore } from '../../app/stores/notifications';
import { playCue, SOUND_LABELS, type SoundCue } from '../../lib/sounds';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Avatar } from '../../components/ui/Avatar';
import { assetUrl } from '../../lib/asset-url';
import { Button, buttonVariants } from '../../components/ui/Button';
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { LabelledField } from '../../components/ui/Field';
import { STATUS_LABEL, StatusDot } from '../../components/ui/Status';
import { NativeSwitch } from '../../components/ui/Switch';
import { toast } from '../../components/ui/Toast';
import { VoicePanel } from './VoicePanel';

interface Section {
  id: UserSettingsSection;
  label: string;
  icon: typeof Palette;
}

const SECTIONS: Section[] = [
  { id: 'profile', label: 'Perfil', icon: Image },
  { id: 'appearance', label: 'Aparência', icon: Palette },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'voice', label: 'Voz e vídeo', icon: Volume2 },
  { id: 'audit', label: 'Auditoria', icon: ShieldCheck },
];

const TITLE: Record<UserSettingsSection, string> = {
  profile: 'Perfil',
  appearance: 'Aparência',
  notifications: 'Notificações',
  voice: 'Voz e vídeo',
  audit: 'Auditoria',
};

/** Pulls the `/files/...` part out of an absolute URL so it can be stored server-side. */
function storedPath(url: string): string {
  const match = url.match(/\/files\/[^?#]+/);
  return match ? match[0] : url;
}

async function uploadImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma imagem.');
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 8 MB.');
  const { attachment } = await api.uploads.upload(file);
  return attachment.url;
}

export function UserSettingsModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  const open = modal?.kind === 'user-settings';
  const [section, setSection] = useState<UserSettingsSection>('profile');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [accentColor, setAccentColor] = useState<string>(DEFAULT_ACCENT_COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [saving, setSaving] = useState(false);

  // only a freshly opened modal (or an explicit section request) resets the tab
  const requestedSection = modal?.kind === 'user-settings' ? (modal.section ?? 'profile') : 'profile';
  useEffect(() => {
    if (!open) return;
    setSection(requestedSection);
  }, [open, requestedSection, modal?.kind]);

  useEffect(() => {
    if (!open || !user) return;
    setDisplayName(user.displayName);
    setBio(user.bio ?? '');
    setAccentColor(user.accentColor);
    setAvatarUrl(user.avatarUrl);
    setBannerUrl(user.bannerUrl);
  }, [open, modal, user]);

  const pickImage = useCallback(
    async (kind: 'avatar' | 'banner', file: File | undefined) => {
      if (!file) return;
      setUploading(kind);
      try {
        const url = await uploadImage(file);
        if (kind === 'avatar') setAvatarUrl(url);
        else setBannerUrl(url);
      } catch (error) {
        toast.error('Falha no upload', error instanceof Error ? error.message : undefined);
      } finally {
        setUploading(null);
      }
    },
    [],
  );

  if (!user) return null;

  const dirty =
    displayName.trim() !== user.displayName ||
    bio.trim() !== (user.bio ?? '') ||
    accentColor !== user.accentColor ||
    storedPath(avatarUrl ?? '') !== storedPath(user.avatarUrl ?? '') ||
    storedPath(bannerUrl ?? '') !== storedPath(user.bannerUrl ?? '');

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim() ? bio.trim() : null,
        accentColor,
        avatarUrl: avatarUrl ? storedPath(avatarUrl) : null,
        bannerUrl: bannerUrl ? storedPath(bannerUrl) : null,
      });
      toast.success('Perfil atualizado');
    } catch (error) {
      toast.error('Falha ao salvar', error instanceof Error ? error.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        size="settings"
        title={TITLE[section]}
        bleed
        hideClose
        hideFooter
        className="bg-app text-normal [&>header]:hidden"
      >
        <div className="grid h-full min-h-0 grid-cols-[232px_1fr]">
          <aside className="flex min-h-0 flex-col bg-app-alt py-6 pl-4 pr-2">
            {SECTIONS.map((item) => (
              <NavItem key={item.id} active={section === item.id} icon={item.icon} onClick={() => setSection(item.id)}>
                {item.label}
              </NavItem>
            ))}
            <div className="flex-1" />
            <div className="mt-3 border-t border-divider pt-3">
              <button
                type="button"
                onClick={close}
                className="flex w-full items-center gap-2 rounded-xs px-2.5 py-[6px] text-[15px] font-medium text-muted transition-colors hover:bg-hover/60 hover:text-normal"
              >
                <X size={16} aria-hidden /> Fechar
              </button>
            </div>
          </aside>

          {/*
            The page title scrolls with its content instead of sitting in a sticky bar with a
            close button: the sidebar already has "Fechar", so the header is part of the page.
          */}
          <main className="relative flex min-h-0 flex-col bg-chat">
            <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
              <h2 className="pb-3 pt-7 text-xl font-semibold leading-6 text-heading [border-bottom:1px_solid_var(--color-divider)]">{TITLE[section]}</h2>
              <div className="pt-4" />
              {section === 'profile' ? (
                <ProfileSection
                  user={user}
                  displayName={displayName}
                  onDisplayName={setDisplayName}
                  bio={bio}
                  onBio={setBio}
                  avatarUrl={avatarUrl}
                  bannerUrl={bannerUrl}
                  accentColor={accentColor}
                  uploading={uploading}
                  onPick={pickImage}
                  onClearAvatar={() => setAvatarUrl(null)}
                  onClearBanner={() => setBannerUrl(null)}
                  onAccent={setAccentColor}
                  saving={saving}
                  dirty={dirty}
                  canSave={!!displayName.trim()}
                  onSave={() => void save()}
                  onLogout={logout}
                />
              ) : null}
              {section === 'appearance' ? (
                <AppearanceSection theme={theme} onTheme={(next) => setTheme(next as ThemeId)} />
              ) : null}
              {section === 'notifications' ? <NotificationsSection /> : null}
              {/* the voice panel brings its own block headings, so the repeated page title is dropped */}
              {section === 'voice' ? <VoicePanel /> : null}
              {section === 'audit' ? <AuditSection /> : null}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NavItem({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: typeof Palette;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xs px-2.5 py-[6px] text-[15px] font-medium transition-colors',
        active ? 'bg-selected text-heading' : 'text-muted hover:bg-hover/60 hover:text-normal',
      )}
    >
      <Icon size={16} aria-hidden />
      <span className="truncate">{children}</span>
    </button>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-md bg-app-alt p-4', className)}>{children}</div>;
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{children}</h3>
      {description ? <p className="mt-1 text-xs text-faint">{description}</p> : null}
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success(`${label} copiado`);
    } catch {
      toast.error('Não foi possível copiar');
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-sm bg-input-sunken px-3 py-2">
      <span className="selectable min-w-0 flex-1 truncate font-mono text-[13px] text-normal">{value}</span>
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} Copiar
      </Button>
    </div>
  );
}

function ProfileSection({
  user,
  displayName,
  onDisplayName,
  bio,
  onBio,
  avatarUrl,
  bannerUrl,
  accentColor,
  uploading,
  onPick,
  onClearAvatar,
  onClearBanner,
  onAccent,
  saving,
  dirty,
  canSave,
  onSave,
  onLogout,
}: {
  user: PublicUser;
  displayName: string;
  onDisplayName: (value: string) => void;
  bio: string;
  onBio: (value: string) => void;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string;
  uploading: 'avatar' | 'banner' | null;
  onPick: (kind: 'avatar' | 'banner', file: File | undefined) => void;
  onClearAvatar: () => void;
  onClearBanner: () => void;
  onAccent: (color: string) => void;
  saving: boolean;
  dirty: boolean;
  canSave: boolean;
  onSave: () => void;
  onLogout: () => void;
}) {
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => setStatus(user.status), [user.status]);

  const changeStatus = async (next: UserStatus) => {
    setStatus(next);
    setSavingStatus(true);
    try {
      await updateProfile({ status: next });
    } catch (error) {
      toast.error('Falha ao mudar o status', error instanceof Error ? error.message : undefined);
      setStatus(user.status);
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="overflow-hidden rounded-md bg-app-alt">
        <div
          className="relative h-32"
          style={{
            background: bannerUrl
              ? undefined
              : `linear-gradient(135deg, ${accentColor}66, ${accentColor}14 60%, transparent)`,
          }}
        >
          {bannerUrl ? <img src={assetUrl(bannerUrl, { token: currentToken() })} alt="Banner" className="absolute inset-0 size-full object-cover" /> : null}
          <div className="absolute right-3 top-3 flex gap-1.5">
            <label
              className={cn(
                buttonVariants({ variant: 'secondary', size: 'sm' }),
                'cursor-pointer border-line-strong hover:border-line-strong',
              )}
            >
              <ImagePlus size={14} aria-hidden />
              {uploading === 'banner' ? 'Enviando…' : 'Trocar banner'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  onPick('banner', event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {bannerUrl ? (
              <Button variant="ghost" size="icon" aria-label="Remover banner" title="Remover banner" onClick={onClearBanner}>
                <X />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="relative z-10 -mt-10 flex items-end gap-4 px-4 pb-4">
          <Avatar name={user.displayName} src={avatarUrl} color={accentColor} size="lg" className="border-[5px] border-app-alt">
            <label
              aria-label="Trocar foto de perfil"
              className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/55 text-[11px] font-medium text-on-image opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100"
            >
              {uploading === 'avatar' ? '…' : 'Trocar'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  onPick('avatar', event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </Avatar>
          <div className="min-w-0 pb-1">
            <div className="truncate text-lg font-semibold text-heading">{user.displayName}</div>
            <div className="truncate text-sm text-muted">@{user.username}</div>
          </div>
          {avatarUrl ? (
            <button
              type="button"
              onClick={onClearAvatar}
              className="mb-1 ml-auto text-xs text-muted hover:text-red"
            >
              Remover foto
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <SectionTitle>Nome e cor</SectionTitle>
        <Card className="flex flex-col gap-4">
          <LabelledField label="Nome de exibição" htmlFor="profile-display-name">
            <input
              id="profile-display-name"
              value={displayName}
              maxLength={40}
              aria-label="Nome de exibição"
              onChange={(event) => onDisplayName(event.target.value)}
              className="h-9 rounded-sm border border-divider bg-input-sunken px-2.5 text-sm text-normal outline-none focus:border-brand"
            />
          </LabelledField>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Cor de destaque</span>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Cor ${color}`}
                  aria-pressed={accentColor === color}
                  onClick={() => onAccent(color)}
                  className={cn(
                    'size-8 rounded-full ring-offset-2 ring-offset-app-alt transition-transform hover:scale-110',
                    accentColor === color && 'ring-2 ring-brand',
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <p className="text-xs text-faint">
              Usada quando você não tem foto e no degradê do banner padrão.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wide text-muted">Bio</span>
            <textarea
              value={bio}
              maxLength={190}
              rows={3}
              aria-label="Bio"
              placeholder="Conte um pouco sobre você"
              onChange={(event) => onBio(event.target.value)}
              className="resize-none rounded-sm border border-divider bg-input-sunken px-2.5 py-2 text-sm leading-relaxed text-normal outline-none placeholder:text-faint focus:border-brand"
            />
            <span className="self-end text-[11px] tabular-nums text-faint">{bio.length}/190</span>
          </label>
        </Card>
      </div>

      <div>
        <SectionTitle description="Aparece para amigos e no seu perfil.">Status</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          {USER_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              disabled={savingStatus}
              onClick={() => void changeStatus(option)}
              className={cn(
                'flex items-center gap-2 rounded-sm border px-3 py-2 text-sm transition-colors',
                status === option
                  ? 'border-brand bg-brand-soft text-heading'
                  : 'border-divider text-normal hover:border-muted',
              )}
            >
              <StatusDot status={option} />
              {STATUS_LABEL[option]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Seu identificador</SectionTitle>
        <CopyField label="Seu user ID" value={user.id} />
        <p className="mt-1.5 text-xs text-faint">Compartilhe para que alguém te adicione como amigo pelo ID.</p>
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" loading={saving} disabled={!dirty || !canSave} onClick={onSave}>
          Salvar alterações
        </Button>
      </div>

      <div>
        <SectionTitle>Conta</SectionTitle>
        <Button variant="danger" onClick={onLogout}>
          <LogOut size={15} aria-hidden /> Sair da conta
        </Button>
      </div>
    </div>
  );
}

function AppearanceSection({ theme, onTheme }: { theme: ThemeId; onTheme: (id: ThemeId) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <SectionTitle description="A troca é imediata e fica salva neste computador.">Tema</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
        {THEMES.map((option) => {
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={option.name}
              onClick={() => onTheme(option.id)}
              className={cn(
                'group flex flex-col gap-2 rounded-md border p-1.5 text-left transition-colors',
                active ? 'border-brand bg-brand-soft' : 'border-divider hover:border-muted',
              )}
            >
              <ThemePreview palette={option.palette} />
              <span className="flex items-center gap-2 px-1 pb-0.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-heading">{option.name}</span>
                  <span className="block truncate text-[11px] text-muted" title={option.description}>
                    {option.description}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
                  )}
                >
                  {active ? <Check size={11} strokeWidth={3} /> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Miniature of the app in the theme's own palette: server rail, channel column,
 * chat with message bubbles and the identity dock. Every colour comes from the
 * theme entry, so the card shows the real proportions instead of swatches.
 */
function ThemePreview({ palette }: { palette: (typeof THEMES)[number]['palette'] }) {
  const bubble = `color-mix(in srgb, ${palette.text} 14%, transparent)`;
  const thread = `color-mix(in srgb, ${palette.text} 26%, transparent)`;
  return (
    <span
      aria-hidden
      className="flex h-[86px] gap-px overflow-hidden rounded-sm"
      style={{ backgroundColor: palette.app }}
    >
      <span className="flex w-6 shrink-0 flex-col items-center gap-1.5 py-1.5" style={{ backgroundColor: palette.app }}>
        <span className="size-3.5 rounded-full" style={{ backgroundColor: bubble }} />
        <span className="size-3.5 rounded-full" style={{ backgroundColor: bubble }} />
        <span className="size-3.5 rounded-full" style={{ backgroundColor: palette.brand }} />
      </span>
      <span className="flex w-10 shrink-0 flex-col gap-1.5 px-1 py-1.5" style={{ backgroundColor: palette.sidebar }}>
        <span className="h-1 w-7 rounded-full" style={{ backgroundColor: thread }} />
        <span className="h-1 w-6 rounded-full" style={{ backgroundColor: bubble }} />
        <span className="h-1 w-5 rounded-full" style={{ backgroundColor: bubble }} />
        <span className="h-1 w-7 rounded-full" style={{ backgroundColor: thread }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-2 px-1.5 py-1.5" style={{ backgroundColor: palette.chat }}>
        <span className="flex gap-1">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.brand }} />
          <span className="flex flex-1 flex-col gap-1 pt-0.5">
            <span className="h-1 w-8 rounded-full" style={{ backgroundColor: thread }} />
            <span className="h-1 w-full rounded-full" style={{ backgroundColor: bubble }} />
            <span className="h-1 w-3/4 rounded-full" style={{ backgroundColor: bubble }} />
          </span>
        </span>
        <span className="flex gap-1">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: thread }} />
          <span className="flex flex-1 flex-col gap-1 pt-0.5">
            <span className="h-1 w-6 rounded-full" style={{ backgroundColor: thread }} />
            <span className="h-1 w-5/6 rounded-full" style={{ backgroundColor: bubble }} />
          </span>
        </span>
        <span className="mt-auto flex items-center gap-1 rounded-sm p-1" style={{ backgroundColor: palette.elevated }}>
          <span className="size-2.5 rounded-full" style={{ backgroundColor: palette.brand }} />
          <span className="h-1 w-6 rounded-full" style={{ backgroundColor: thread }} />
          <span className="ml-auto size-2 rounded-full border" style={{ borderColor: palette.divider }} />
          <span className="size-2 rounded-full border" style={{ borderColor: palette.divider }} />
        </span>
      </span>
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-sm px-1 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-normal">{label}</span>
        {description ? <span className="block text-xs text-faint">{description}</span> : null}
      </span>
      <NativeSwitch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

const PREVIEW_CUES: SoundCue[] = ['message', 'mention', 'dm', 'join-call', 'leave-call'];

function NotificationsSection() {
  const prefs = useNotificationStore((state) => state.prefs);
  const setPrefs = useNotificationStore((state) => state.setPrefs);
  const toggleMutedGuild = useNotificationStore((state) => state.toggleMutedGuild);
  const guilds = useChatStore((state) => state.guilds);
  const [permission, setPermission] = useState<string>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported',
  );

  const askPermission = async () => {
    const granted = await requestDesktopPermission();
    setPermission(granted ? 'granted' : 'denied');
    if (granted) toast.success('Notificações do sistema ativadas');
    else toast.error('Permissão negada', 'Ative as notificações do Phanteon nas configurações do sistema.');
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionTitle description="Sons suaves sintetizados no próprio app.">Sons</SectionTitle>
        <Card className="flex flex-col gap-1 py-2">
          <Toggle
            checked={prefs.enabled}
            onChange={(enabled) => setPrefs({ enabled })}
            label="Ativar notificações"
            description="Mensagens, menções, DMs e chamadas."
          />
          <Toggle
            checked={prefs.soundsForMessages}
            onChange={(soundsForMessages) => setPrefs({ soundsForMessages })}
            label="Som para mensagens comuns"
            description="Menções e DMs sempre tocam quando as notificações estão ativas."
          />
          <Toggle
            checked={prefs.soundsForCalls}
            onChange={(soundsForCalls) => setPrefs({ soundsForCalls })}
            label="Som ao entrar e sair de chamadas"
          />
        </Card>
      </div>

      <div>
        <SectionTitle>Volume dos sons</SectionTitle>
        <Card>
          <div className="flex items-center gap-3">
            <Volume2 size={16} className="shrink-0 text-muted" aria-hidden />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(prefs.volume * 100)}
              aria-label="Volume dos sons"
              onChange={(event) => setPrefs({ volume: Number(event.target.value) / 100 })}
              onPointerUp={() => playCue('message', prefs.volume)}
              className="h-1.5 flex-1 cursor-pointer accent-[var(--color-brand)]"
            />
            <span className="w-9 text-right text-xs tabular-nums text-muted">{Math.round(prefs.volume * 100)}%</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PREVIEW_CUES.map((cue) => (
              <Button key={cue} variant="secondary" size="sm" onClick={() => playCue(cue, prefs.volume)}>
                <Play size={12} aria-hidden /> {SOUND_LABELS[cue]}
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <div>
        <SectionTitle description="Notificações do sistema aparecem fora do app.">Área de trabalho</SectionTitle>
        <Card className="flex flex-col gap-1 py-2">
          <Toggle
            checked={prefs.desktop}
            onChange={(desktop) => setPrefs({ desktop })}
            label="Notificar na área de trabalho"
          />
          <Toggle
            checked={prefs.showWhenFocused}
            onChange={(showWhenFocused) => setPrefs({ showWhenFocused })}
            label="Também mostrar com o app em foco"
          />
          {permission !== 'granted' ? (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-sm bg-input-sunken px-3 py-2">
              <span className="text-xs text-muted">
                {permission === 'denied'
                  ? 'Permissão negada pelo sistema — habilite nas configurações do SO.'
                  : 'O sistema ainda precisa permitir as notificações.'}
              </span>
              <Button variant="primary" size="sm" onClick={() => void askPermission()}>
                <BellRing size={13} aria-hidden /> Permitir
              </Button>
            </div>
          ) : null}
        </Card>
      </div>

      <div>
        <SectionTitle description="Servidores silenciados não tocam nem contam no sino.">Servidores</SectionTitle>
        <ul className="flex flex-col divide-y divide-divider overflow-hidden rounded-md bg-app-alt">
          {guilds.map((guild) => {
            const muted = prefs.mutedGuilds.includes(guild.id);
            return (
              <li key={guild.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-normal">{guild.name}</span>
                <Button
                  variant={muted ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => toggleMutedGuild(guild.id)}
                >
                  {muted ? 'Silenciado' : 'Silenciar'}
                </Button>
              </li>
            );
          })}
          {guilds.length === 0 ? <li className="px-3 py-3 text-xs text-muted">Você ainda não está em servidores.</li> : null}
        </ul>
      </div>
    </div>
  );
}

function AuditSection() {
  const [guilds, setGuilds] = useState<{ id: string; name: string; canView: boolean }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { guilds: summaries } = await api.guilds.list();
        const entries = await Promise.all(
          summaries.map(async (guild) => {
            try {
              const { guild: details } = await api.guilds.get(guild.id);
              return { id: guild.id, name: guild.name, canView: details.isOwner || (details.myPermissions & Permission.ViewAuditLog) === Permission.ViewAuditLog };
            } catch {
              return { id: guild.id, name: guild.name, canView: false };
            }
          }),
        );
        if (!cancelled) setGuilds(entries);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = guilds.filter((guild) => guild.canView);

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle description="Servidores onde você pode consultar os logs de auditoria.">
        Auditoria de servidores
      </SectionTitle>
      {loading ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : visible.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Você não tem a permissão “Ver logs de auditoria” em nenhum servidor. Peça a um administrador para
            conceder no cargo.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((guild) => (
            <li key={guild.id}>
              <button
                type="button"
                onClick={() => useUiStore.getState().openModal({ kind: 'guild-settings', guildId: guild.id, section: 'audit' })}
                className="flex w-full items-center gap-2 rounded-md border border-divider bg-app-alt px-3 py-2 text-left text-sm text-normal hover:border-muted"
              >
                <ShieldCheck size={15} className="text-brand" aria-hidden />
                <span className="flex-1 truncate">{guild.name}</span>
                <span className="text-[11px] text-muted">Abrir logs</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
