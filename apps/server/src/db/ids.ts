export function newId(): string {
  return crypto.randomUUID();
}

const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newInviteCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join('');
}

export function nowIso(): string {
  return new Date().toISOString();
}
