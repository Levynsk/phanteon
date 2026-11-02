import { useEffect, useState } from 'react';
import { FolderTree, Hammer, Hash, Lock, ScrollText, Shield, Users } from 'lucide-react';
import { Permission } from '@phanteon/shared';
import { canInGuild, useChatStore } from '../../app/stores/chat';
import { useAuthStore } from '../../app/stores/auth';
import { useUiStore } from '../../app/stores/ui';
import { Dialog, DialogContent } from '../../components/ui/Dialog';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { canManageRoles, myPosition } from './permissions';
import { MembersTab } from './MembersTab';
import { BansTab } from './BansTab';
import { AuditTab } from './AuditTab';
import { OverviewTab } from './OverviewTab';
import { RolesTab } from './RolesTab';
import { ChannelsTab } from './ChannelsTab';
import { SettingsNavItem, SettingsPage, SettingsShell, SettingsSidebar } from './SettingsSection';

type Section = 'overview' | 'channels' | 'roles' | 'members' | 'bans' | 'audit';

const SECTIONS: { id: Section; label: string; icon: typeof Hash; permission: number }[] = [
  { id: 'overview', label: 'Visão geral', icon: Hash, permission: Permission.ManageGuild },
  { id: 'channels', label: 'Canais', icon: FolderTree, permission: Permission.ManageChannels },
  { id: 'roles', label: 'Cargos', icon: Shield, permission: Permission.ManageRoles },
  { id: 'members', label: 'Membros', icon: Users, permission: Permission.ManageMembers },
  { id: 'bans', label: 'Banimentos', icon: Hammer, permission: Permission.BanMembers },
  { id: 'audit', label: 'Logs de auditoria', icon: ScrollText, permission: Permission.ViewAuditLog },
];

const SECTION_TITLE: Record<Section, string> = {
  overview: 'Visão geral do servidor',
  channels: 'Canais e categorias',
  roles: 'Cargos',
  members: 'Membros',
  bans: 'Banimentos',
  audit: 'Logs de auditoria',
};

const SECTION_DESCRIPTION: Record<Section, string> = {
  overview: 'Aparência e informações que aparecem para todo mundo no servidor.',
  channels: 'Organize os canais em categorias e decida quem pode ver cada um.',
  roles: 'Crie cargos, ajuste permissões e defina a ordem de cada um.',
  members: 'Veja quem está no servidor e quais cargos cada pessoa tem.',
  bans: 'Pessoas banidas podem ter o banimento revogado a qualquer momento.',
  audit: 'Histórico de moderação, canais, cargos e convites.',
};

export function GuildSettingsModal() {
  const modal = useUiStore((state) => state.modal);
  const close = useUiStore((state) => state.closeModal);
  const guildId = modal?.kind === 'guild-settings' ? modal.guildId : null;
  const initialSection = modal?.kind === 'guild-settings' ? (modal.section ?? 'overview') : 'overview';
  const guild = useChatStore((state) => (guildId ? state.guildDetails[guildId] : undefined));
  const loadGuild = useChatStore((state) => state.loadGuild);
  const currentUser = useAuthStore((state) => state.user);
  const [section, setSection] = useState<Section>(initialSection);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection, modal]);

  useEffect(() => {
    if (guildId) void loadGuild(guildId, { refresh: true }).catch(() => undefined);
  }, [guildId, loadGuild]);

  if (!guildId) return null;
  // opening guild settings requires at least one management permission (owner always wins)
  const canOpenSettings =
    !!guild &&
    canInGuild(
      guild,
      Permission.ManageGuild,
      Permission.ManageChannels,
      Permission.ManageRoles,
      Permission.ManageMembers,
      Permission.BanMembers,
    );
  const canOpen = (id: Section) => !!guild && canInGuild(guild, SECTIONS.find((item) => item.id === id)!.permission);

  // a section the viewer cannot open (permission revoked while the dialog was open) falls back to the first one they can
  const firstAllowed = SECTIONS.find((item) => canOpen(item.id))?.id ?? 'overview';
  const active: Section = canOpen(section) ? section : firstAllowed;

  return (
    <Dialog open={modal?.kind === 'guild-settings'} onOpenChange={(value) => !value && close()}>
      <DialogContent
        size="settings"
        title={guild?.name ?? 'Servidor'}
        bleed
        hideClose
        hideFooter
        className="bg-app text-normal [&>header]:hidden"
      >
        {!guild ? (
          <div className="grid h-full place-items-center text-sm text-muted">Carregando servidor…</div>
        ) : !canOpenSettings ? (
          <SettingsShell className="place-items-center">
            <div className="col-span-2 max-w-sm text-center">
              <Lock size={28} className="mx-auto text-muted" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold text-heading">Sem permissão</h2>
              <p className="mt-1 text-sm text-muted">
                Você não tem acesso às configurações deste servidor. Peça a um administrador para ajustar seus cargos.
              </p>
              <Button variant="primary" size="sm" className="mt-4" onClick={close}>
                Fechar
              </Button>
            </div>
          </SettingsShell>
        ) : (
          <SettingsShell>
            <SettingsSidebar
              onClose={close}
              header={
                <div className="mb-4 flex items-center gap-2.5 px-2">
                  <Avatar name={guild.name} src={guild.iconUrl} color={guild.iconColor} className="size-8 rounded-md text-xs" />
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-heading">{guild.name}</h3>
                    <p className="truncate text-[11px] text-muted">Configurações do servidor</p>
                  </div>
                </div>
              }
            >
              {SECTIONS.map((item) => {
                const allowed = canOpen(item.id);
                return (
                  <SettingsNavItem
                    key={item.id}
                    active={active === item.id}
                    icon={<item.icon size={16} aria-hidden />}
                    disabled={!allowed}
                    title={allowed ? undefined : `Sem permissão: ${item.label}`}
                    trailing={allowed ? null : <Lock size={12} aria-hidden />}
                    onClick={() => setSection(item.id)}
                  >
                    {item.label}
                  </SettingsNavItem>
                );
              })}
            </SettingsSidebar>

            <SettingsPage key={active} title={SECTION_TITLE[active]} description={SECTION_DESCRIPTION[active]}>
              {active === 'overview' ? <OverviewTab guild={guild} canManageGuild={canOpen('overview')} /> : null}
              {active === 'channels' ? <ChannelsTab guildId={guild.id} /> : null}
              {active === 'roles' && currentUser ? (
                <RolesTab
                  guildId={guild.id}
                  canManageRoles={canManageRoles(guild)}
                  canManageMembers={canInGuild(guild, Permission.ManageMembers)}
                  myPosition={myPosition(guild, currentUser.id)}
                />
              ) : null}
              {active === 'members' && currentUser ? (
                <MembersTab
                  guildId={guild.id}
                  canManageMembers={canInGuild(guild, Permission.ManageMembers)}
                  myPosition={myPosition(guild, currentUser.id)}
                />
              ) : null}
              {active === 'bans' ? <BansTab guildId={guild.id} canBan={canOpen('bans')} /> : null}
              {active === 'audit' ? <AuditTab guildId={guild.id} canView={canOpen('audit')} /> : null}
            </SettingsPage>
          </SettingsShell>
        )}
      </DialogContent>
    </Dialog>
  );
}
