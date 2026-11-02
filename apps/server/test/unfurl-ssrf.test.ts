import { beforeAll, describe, expect, test } from 'bun:test';
import { isPublicHttpUrl, readEmbed, redirectTarget } from '../src/services/link-preview';
import { useTempDataDir } from './helpers';

const helpers = await import('./helpers');
// before the server modules load, so their config points at a throwaway database
useTempDataDir();

async function callUnfurl(url: string) {
  const { createApp } = await import('../src/app');
  const { migrate } = await import('../src/db/migrate');
  migrate();
  const client = helpers.createClient(createApp());
  return client.call('GET', `/api/unfurl?url=${encodeURIComponent(url)}`, { token: (await client.register()).token });
}

beforeAll(() => {
  // per-case databases live under the temp dir
});

function html(meta: string): string {
  return `<html><head>${meta}<title>Exemplo</title></head><body></body></html>`;
}

const publicUrl = 'https://site.example/page';

describe('link preview SSRF guard', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://127.1/',
    'http://127.42.0.9/',
    'http://10.0.0.5/',
    'http://172.20.1.1/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://foo.localhost/',
    'http://db.internal/',
    'ftp://site.example/',
    'file:///etc/passwd',
  ];

  for (const url of blocked) {
    test(`refuses ${url}`, () => {
      expect(isPublicHttpUrl(url)).toBe(false);
    });
  }

  for (const url of ['https://site.example/page', 'http://203.0.113.10/ok']) {
    test(`accepts ${url}`, () => {
      expect(isPublicHttpUrl(url)).toBe(true);
    });
  }

  test('redirect targets are resolved and must stay public', () => {
    expect(redirectTarget(publicUrl, 'https://other.example/next')).toBe('https://other.example/next');
    expect(() => redirectTarget(publicUrl, 'http://127.0.0.1/admin')).toThrow();
    expect(() => redirectTarget(publicUrl, 'file:///etc/passwd')).toThrow();
    expect(() => redirectTarget(publicUrl, 'javascript:alert(1)')).toThrow();
  });

  test('a public page cannot redirect the fetch onto the local network', async () => {
    const hits: string[] = [];
    // stands in for the public internet: answers with a card, then redirects to loopback
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        hits.push(new URL(request.url).pathname);
        if (new URL(request.url).pathname === '/start') {
          return new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${server.port}/private` } });
        }
        return new Response('<title>segredo interno</title>', { headers: { 'content-type': 'text/html' } });
      },
    });
    try {
      const res = await callUnfurl(`${server.url}start`);
      // the old code followed the redirect and read the internal page
      expect(hits).not.toContain('/private');
      expect(JSON.stringify(res.body)).not.toContain('segredo interno');
    } finally {
      server.stop(true);
    }
  });

  test('an og:image on the local network never reaches the client', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response('<meta property="og:image" content="http://127.0.0.1:3010/internal.png"><title>ok</title>', {
          headers: { 'content-type': 'text/html' },
        }),
    });
    try {
      const res = await callUnfurl(server.url.toString());
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    } finally {
      server.stop(true);
    }
  });
});

describe('link preview embeds drop internal images and links', () => {
  test('an og:image on a private host is removed', () => {
    const embed = readEmbed(html('<meta property="og:image" content="http://169.254.169.254/latest/meta-data/iam">'), publicUrl);
    expect(embed.image).toBeNull();
  });

  test('an og:image with a relative public path is kept', () => {
    const embed = readEmbed(html('<meta property="og:image" content="/img/card.png">'), publicUrl);
    expect(embed.image).toBe('https://site.example/img/card.png');
  });

  test('an og:image pointing back at a port of the host is kept (same public host)', () => {
    const embed = readEmbed(html('<meta property="og:image" content="//cdn.site.example/a.png">'), publicUrl);
    expect(embed.image).toBe('https://cdn.site.example/a.png');
  });

  test('an og:url on a private host is removed from the embed', () => {
    const embed = readEmbed(html('<meta property="og:url" content="http://10.1.2.3/internal">'), publicUrl);
    expect(JSON.stringify(embed)).not.toContain('10.1.2.3');
  });

  test('the embed never carries a data or javascript image', () => {
    const embed = readEmbed(html('<meta property="og:image" content="javascript:alert(1)">'), publicUrl);
    expect(embed.image).toBeNull();
  });
});
