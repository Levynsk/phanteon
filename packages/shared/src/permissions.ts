/**
 * Guild permissions are a bit field so that several roles can be combined with
 * a single OR — exactly how Discord composes a member's effective permissions.
 * New flags may only be appended, never renumbered.
 */
export const Permission = {
  /** See text channels and read message history. */
  ViewChannel: 1 << 0,
  /** Send messages and document attachments. */
  SendMessages: 1 << 1,
  /** Add reactions and remove other people's reactions. */
  AddReactions: 1 << 2,
  /** Attach images to messages. */
  AttachFiles: 1 << 3,
  /** Edit and delete own messages (others require ManageMessages). */
  ManageOwnMessages: 1 << 4,
  /** Delete anyone's messages. */
  ManageMessages: 1 << 5,
  /** Create, edit and delete invites. */
  CreateInvite: 1 << 6,
  /** Rename guild, change icon/banner and description. */
  ManageGuild: 1 << 7,
  /** Create, edit and delete channels. */
  ManageChannels: 1 << 8,
  /** Create, edit, delete and assign roles below own position. */
  ManageRoles: 1 << 9,
  /** Kick members below own role position. */
  KickMembers: 1 << 10,
  /** Promote/demote and remove members through the member menu. */
  ManageMembers: 1 << 11,
  /** Join voice channels. */
  Connect: 1 << 12,
  /** Transmit audio in voice channels. */
  Speak: 1 << 13,
  /** Server-mute and server-deafen other members in voice. */
  MuteMembers: 1 << 14,
  /** Move members between voice channels and disconnect them. */
  MoveMembers: 1 << 15,
  /** Ban members permanently or for a limited time, and revoke bans. */
  BanMembers: 1 << 16,
  /** Read the guild audit log. */
  ViewAuditLog: 1 << 17,
} as const;

export type PermissionFlag = (typeof Permission)[keyof typeof Permission];

export interface PermissionMeta {
  flag: PermissionFlag;
  key: keyof typeof Permission;
  label: string;
  description: string;
  group: 'geral' | 'membros' | 'mensagens' | 'canais' | 'voz';
}

export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  {
    flag: Permission.ViewChannel,
    key: 'ViewChannel',
    label: 'Ver canais',
    description: 'Ver canais de texto e histórico de mensagens.',
    group: 'geral',
  },
  {
    flag: Permission.CreateInvite,
    key: 'CreateInvite',
    label: 'Criar convites',
    description: 'Gerar códigos de convite para novas pessoas entrarem.',
    group: 'geral',
  },
  {
    flag: Permission.ManageGuild,
    key: 'ManageGuild',
    label: 'Gerenciar servidor',
    description: 'Alterar nome, descrição, ícone e banner do servidor.',
    group: 'geral',
  },
  {
    flag: Permission.ManageChannels,
    key: 'ManageChannels',
    label: 'Gerenciar canais',
    description: 'Criar, renomear e excluir canais.',
    group: 'canais',
  },
  {
    flag: Permission.ManageRoles,
    key: 'ManageRoles',
    label: 'Gerenciar cargos',
    description: 'Criar cargos e alterar permissões abaixo do próprio cargo.',
    group: 'membros',
  },
  {
    flag: Permission.ManageMembers,
    key: 'ManageMembers',
    label: 'Gerenciar membros',
    description: 'Atribuir cargos e remover membros abaixo do próprio cargo.',
    group: 'membros',
  },
  {
    flag: Permission.KickMembers,
    key: 'KickMembers',
    label: 'Expulsar membros',
    description: 'Remover membros do servidor (eles podem voltar com convite).',
    group: 'membros',
  },
  {
    flag: Permission.SendMessages,
    key: 'SendMessages',
    label: 'Enviar mensagens',
    description: 'Enviar mensagens nos canais de texto.',
    group: 'mensagens',
  },
  {
    flag: Permission.AttachFiles,
    key: 'AttachFiles',
    label: 'Anexar arquivos',
    description: 'Enviar imagens junto das mensagens.',
    group: 'mensagens',
  },
  {
    flag: Permission.AddReactions,
    key: 'AddReactions',
    label: 'Adicionar reações',
    description: 'Reagir às mensagens com emojis.',
    group: 'mensagens',
  },
  {
    flag: Permission.ManageOwnMessages,
    key: 'ManageOwnMessages',
    label: 'Editar e excluir próprias mensagens',
    description: 'Editar e apagar mensagens enviadas por você.',
    group: 'mensagens',
  },
  {
    flag: Permission.ManageMessages,
    key: 'ManageMessages',
    label: 'Gerenciar mensagens',
    description: 'Apagar mensagens de qualquer pessoa.',
    group: 'mensagens',
  },
  {
    flag: Permission.BanMembers,
    key: 'BanMembers',
    label: 'Banir membros',
    description: 'Banir membros de forma permanente ou temporária e revogar bans.',
    group: 'membros',
  },
  {
    flag: Permission.ViewAuditLog,
    key: 'ViewAuditLog',
    label: 'Ver logs de auditoria',
    description: 'Consultar o histórico de ações de moderação e administração.',
    group: 'geral',
  },
  {
    flag: Permission.Connect,
    key: 'Connect',
    label: 'Conectar',
    description: 'Entrar em canais de voz.',
    group: 'voz',
  },
  {
    flag: Permission.Speak,
    key: 'Speak',
    label: 'Falar',
    description: 'Transmitir áudio nos canais de voz.',
    group: 'voz',
  },
  {
    flag: Permission.MuteMembers,
    key: 'MuteMembers',
    label: 'Silenciar membros',
    description: 'Silenciar e ensurdecer outros membros na voz.',
    group: 'voz',
  },
  {
    flag: Permission.MoveMembers,
    key: 'MoveMembers',
    label: 'Mover membros',
    description: 'Mover membros entre canais de voz e desconectá-los.',
    group: 'voz',
  },
] as const;

/** Every flag, useful for the owner role and for full-access defaults. */
export const ALL_PERMISSIONS: number = PERMISSION_CATALOG.reduce((mask, meta) => mask | meta.flag, 0);

/** What `@everyone` gets by default in a new guild. */
export const DEFAULT_EVERYONE_PERMISSIONS: number =
  Permission.ViewChannel |
  Permission.CreateInvite |
  Permission.SendMessages |
  Permission.AttachFiles |
  Permission.AddReactions |
  Permission.ManageOwnMessages |
  Permission.Connect |
  Permission.Speak;

export function hasPermission(mask: number, flag: PermissionFlag): boolean {
  return (mask & flag) === flag;
}

export function permissionKeysFromMask(mask: number): (keyof typeof Permission)[] {
  return PERMISSION_CATALOG.filter((meta) => hasPermission(mask, meta.flag)).map((meta) => meta.key);
}
