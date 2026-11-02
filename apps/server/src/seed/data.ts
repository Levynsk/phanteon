import { eq } from 'drizzle-orm';
import { DEFAULT_EVERYONE_PERMISSIONS, Permission } from '@phanteon/shared';
import { db, schema } from '../db/client';
import { newId, newInviteCode, nowIso } from '../db/ids';
import { hashPassword } from '../auth/password';
import {
  ADMIN_ROLE_ID_PREFIX,
  EVERYONE_ROLE_ID_PREFIX,
  MEMBER_ROLE_ID_PREFIX,
} from '../services/roles';

interface SeedUser {
  username: string;
  displayName: string;
  email: string;
  password: string;
  accentColor: string;
  status: 'online' | 'idle' | 'dnd' | 'offline';
}

const SEED_USERS: SeedUser[] = [
  {
    username: 'demo',
    displayName: 'Demo',
    email: 'demo@phanteon.local',
    password: 'demo1234',
    accentColor: '#fbbf24',
    status: 'online',
  },
  {
    username: 'ana',
    displayName: 'Ana Souza',
    email: 'ana@phanteon.local',
    password: 'demo1234',
    accentColor: '#f472b6',
    status: 'online',
  },
  {
    username: 'bruno',
    displayName: 'Bruno Lima',
    email: 'bruno@phanteon.local',
    password: 'demo1234',
    accentColor: '#4ade80',
    status: 'idle',
  },
  {
    username: 'carla',
    displayName: 'Carla Dias',
    email: 'carla@phanteon.local',
    password: 'demo1234',
    accentColor: '#22d3ee',
    status: 'dnd',
  },
];

const CHANNELS = [
  { name: 'geral', topic: 'Converse sobre qualquer coisa por aqui.', type: 'text' as const },
  { name: 'apresentacoes', topic: 'Se apresente para a comunidade!', type: 'text' as const },
  { name: 'dev', topic: 'Bun, TypeScript, React e Welcome UI.', type: 'text' as const },
  { name: 'sussurros', topic: 'Memes e bobagens.', type: 'text' as const },
  { name: 'voz-geral', topic: null, type: 'voice' as const },
];

const SEED_MESSAGES: { channel: string; author: string; content: string; minutesAgo: number }[] = [
  { channel: 'geral', author: 'ana', content: 'Oi pessoal! Bem-vindos ao clone do Discord 🚀', minutesAgo: 90 },
  { channel: 'geral', author: 'bruno', content: 'Finalmente alguém construiu algo com Bun 😅', minutesAgo: 86 },
  { channel: 'geral', author: 'demo', content: 'O backend roda em Hono + SQLite e o app é Electron + React.', minutesAgo: 81 },
  { channel: 'geral', author: 'carla', content: 'E o visual é todo feito com componentes Radix UI. Ficou bonito!', minutesAgo: 75 },
  { channel: 'dev', author: 'demo', content: 'A comunicação em tempo real usa WebSocket nativo do Bun.', minutesAgo: 44 },
  { channel: 'dev', author: 'ana', content: 'Reações, digitação e presença também funcionam.', minutesAgo: 40 },
  { channel: 'apresentacoes', author: 'carla', content: 'Olá! Sou designer e adoro paletas escuras.', minutesAgo: 30 },
  { channel: 'sussurros', author: 'bruno', content: 'Quem foi que apagou o canal #off-topic? 😱', minutesAgo: 12 },
];

/** Mirrors the default `Administrador` role created for new guilds. */
const ADMIN_PERMISSIONS =
  Permission.ViewChannel |
  Permission.CreateInvite |
  Permission.ManageGuild |
  Permission.ManageChannels |
  Permission.ManageRoles |
  Permission.ManageMembers |
  Permission.KickMembers |
  Permission.SendMessages |
  Permission.AttachFiles |
  Permission.AddReactions |
  Permission.ManageOwnMessages |
  Permission.ManageMessages;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export async function seed(): Promise<{ guildId: string; inviteCode: string }> {
  const existing = db.select().from(schema.users).where(eq(schema.users.username, 'demo')).get();
  if (existing) {
    const invite = db.select().from(schema.invites).where(eq(schema.invites.inviterId, existing.id)).get();
    return { guildId: invite?.guildId ?? '', inviteCode: invite?.code ?? '' };
  }

  const userRows = await Promise.all(
    SEED_USERS.map(async (seedUser) => ({
      id: newId(),
      username: seedUser.username,
      displayName: seedUser.displayName,
      email: seedUser.email,
      passwordHash: await hashPassword(seedUser.password),
      avatarUrl: null,
      bannerUrl: null,
      bio: null,
      accentColor: seedUser.accentColor,
      status: seedUser.status,
      createdAt: nowIso(),
    })),
  );
  const byUsername = new Map(userRows.map((row) => [row.username, row]));
  const demo = byUsername.get('demo')!;
  const guildId = newId();
  const now = nowIso();
  const inviteCode = newInviteCode();

  db.transaction((tx) => {
    tx.insert(schema.users).values(userRows).run();
    tx.insert(schema.guilds)
      .values({
        id: guildId,
        name: 'Discord Clone',
        description: 'Comunidade de demonstração do clone — cargos, permissões e imagens funcionando de verdade.',
        iconColor: '#fbbf24',
        iconUrl: null,
        bannerUrl: null,
        ownerId: demo.id,
        createdAt: now,
      })
      .run();

    const everyOneRole = `${EVERYONE_ROLE_ID_PREFIX}${guildId}`;
    const adminRole = `${ADMIN_ROLE_ID_PREFIX}${guildId}`;
    const memberRole = `${MEMBER_ROLE_ID_PREFIX}${guildId}`;
    tx.insert(schema.roles)
      .values([
        {
          id: everyOneRole,
          guildId,
          name: '@everyone',
          color: '#99aab5',
          permissions: DEFAULT_EVERYONE_PERMISSIONS,
          position: 0,
          isEveryone: true,
          isSystem: true,
          createdAt: now,
        },
        {
          id: adminRole,
          guildId,
          name: 'Administrador',
          color: '#fbbf24',
          permissions: ADMIN_PERMISSIONS,
          position: 2,
          isEveryone: false,
          isSystem: true,
          createdAt: now,
        },
        {
          id: memberRole,
          guildId,
          name: 'Membro',
          color: '#4ade80',
          permissions: 0,
          position: 1,
          isEveryone: false,
          isSystem: true,
          createdAt: now,
        },
      ])
      .run();

    tx.insert(schema.memberRoles)
      .values([
        { guildId, userId: byUsername.get('ana')!.id, roleId: adminRole },
        { guildId, userId: byUsername.get('bruno')!.id, roleId: memberRole },
        { guildId, userId: byUsername.get('carla')!.id, roleId: memberRole },
      ])
      .run();

    tx.insert(schema.guildMembers)
      .values([
        { guildId, userId: demo.id, role: 'owner', joinedAt: now },
        { guildId, userId: byUsername.get('ana')!.id, role: 'admin', joinedAt: now },
        { guildId, userId: byUsername.get('bruno')!.id, role: 'member', joinedAt: now },
        { guildId, userId: byUsername.get('carla')!.id, role: 'member', joinedAt: now },
      ])
      .run();

    const channelRows = CHANNELS.map((channel, index) => ({
      id: newId(),
      kind: 'guild' as const,
      guildId,
      name: channel.name,
      topic: channel.topic,
      type: channel.type,
      position: index,
      createdAt: now,
    }));
    tx.insert(schema.channels).values(channelRows).run();

    const channelByName = new Map(channelRows.map((row) => [row.name, row]));
    tx.insert(schema.messages)
      .values(
        SEED_MESSAGES.map((message) => ({
          id: newId(),
          channelId: channelByName.get(message.channel)!.id,
          authorId: byUsername.get(message.author)!.id,
          content: message.content,
          attachmentId: null,
          editedAt: null,
          createdAt: minutesAgo(message.minutesAgo),
        })),
      )
      .run();

    const dmId = newId();
    tx.insert(schema.channels)
      .values({
        id: dmId,
        kind: 'dm',
        guildId: null,
        name: 'demo-ana',
        topic: null,
        type: 'text',
        position: 0,
        createdAt: minutesAgo(20),
      })
      .run();
    tx.insert(schema.channelMembers)
      .values([
        { channelId: dmId, userId: demo.id },
        { channelId: dmId, userId: byUsername.get('ana')!.id },
      ])
      .run();
    tx.insert(schema.messages)
      .values([
        {
          id: newId(),
          channelId: dmId,
          authorId: byUsername.get('ana')!.id,
          content: 'Ei, testou o envio de arquivos?',
          attachmentId: null,
          editedAt: null,
          createdAt: minutesAgo(18),
        },
        {
          id: newId(),
          channelId: dmId,
          authorId: demo.id,
          content: 'Sim! Basta clicar no clipe no campo de mensagem.',
          attachmentId: null,
          editedAt: null,
          createdAt: minutesAgo(16),
        },
      ])
      .run();

    tx.insert(schema.invites)
      .values({ code: inviteCode, guildId, inviterId: demo.id, uses: 0, createdAt: now })
      .run();
  });

  return { guildId, inviteCode };
}

if (import.meta.main) {
  const { migrate } = await import('../db/migrate');
  migrate();
  const result = await seed();
  console.log(`Seed concluído. Login: demo / demo1234 · Convite: ${result.inviteCode || '(já existente)'}`);
}
