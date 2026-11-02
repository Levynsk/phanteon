export const DEFAULT_ACCENT_COLORS = [
  '#fbbf24',
  '#f59e0b',
  '#4ade80',
  '#22d3ee',
  '#f87171',
  '#a78bfa',
  '#f472b6',
  '#e4e4e7',
] as const;

export const QUICK_EMOJIS = ['👍', '🔥', '😂', '❤️', '🎉', '👀', '✅', '🙌'] as const;

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CHANNEL_NAME_LENGTH = 32;
export const MAX_GUILD_NAME_LENGTH = 48;
export const MAX_GUILD_DESCRIPTION_LENGTH = 280;
export const MAX_ROLE_NAME_LENGTH = 32;
export const MAX_ROLES_PER_GUILD = 40;
/** Guild icons are uploaded as regular images; this caps the stored file size. */
export const MAX_GUILD_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Videos and archives get their own, larger ceilings. */
export const MAX_VIDEO_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Attachments accepted per message. */
export const MAX_MESSAGE_ATTACHMENTS = 10;
export const ALLOWED_UPLOAD_MIME_PREFIXES = ['image/', 'video/', 'audio/'] as const;
/** Archive and document types, matched by extension because browsers report them inconsistently. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'txt',
  'md',
  'json',
  'csv',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'mp3',
  'mp4',
  'webm',
  'mov',
  'ogg',
] as const;
export const PAGE_SIZE = 50;

export const USER_STATUSES = ['online', 'idle', 'dnd', 'offline'] as const;
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,24}$/;
export const CHANNEL_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/;

export function channelSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_CHANNEL_NAME_LENGTH);
}
