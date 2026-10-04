import { test, expect } from '@playwright/test';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
const { fixture, digest } = (await import(
  new URL('../../.test-build/auth-fixture.mjs', import.meta.url).href
)) as typeof import('../fixtures/auth.ts');

test.use({ ignoreHTTPSErrors: true });
async function authServer() {
  const mock = fixture();
  let githubRedirect: URL | undefined;
  const server = createServer(
    {
      key: readFileSync('.test-build/localhost.key'),
      cert: readFileSync('.test-build/localhost.crt'),
    },
    async (req, res) => {
      if (req.url?.startsWith('/synthetic-github')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Synthetic GitHub sign-in</h1>');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers))
        if (value) headers[name] = Array.isArray(value) ? value.join(',') : value;
      const response = await mock.call(req.url!, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
      });
      const output: Record<string, string | string[]> = {};
      response.headers.forEach((value, name) => {
        output[name] = value;
      });
      if (response.headers.getSetCookie().length)
        output['set-cookie'] = response.headers.getSetCookie();
      const location = response.headers.get('Location');
      if (location?.startsWith('https://github.com/')) {
        githubRedirect = new URL(location);
        output.location = origin + '/synthetic-github' + githubRedirect.search;
      }
      res.writeHead(response.status, output);
      res.end(await response.text());
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
  const origin = `https://127.0.0.1:${address.port}`;
  mock.env.PUBLIC_URL = origin;
  return {
    ...mock,
    origin,
    get githubRedirect() {
      return githubRedirect;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('auth forms preserve same-origin CSRF and support script-token creation and revocation', async ({
  page,
  context,
}) => {
  const mock = await authServer();
  try {
    const session = 'browser-synthetic-session';
    mock.records.set(
      'session:' + (await digest(session)),
      JSON.stringify({ userId: 'github-123', login: 'synthetic-user', csrf: 'synthetic-csrf' }),
    );
    await context.addCookies([
      {
        name: '__Host-quietscore-session',
        value: session,
        domain: '127.0.0.1',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto(mock.origin + '/connect');
    await expect(page.getByRole('heading', { name: 'Your MCP connections' })).toBeVisible();
    await page.getByLabel('Token name').fill('Browser regression fixture');
    await page.getByRole('button', { name: 'Create API token' }).click();
    await expect(page.getByText('Copy your token now. It is shown once.')).toBeVisible();
    await expect(page.locator('code').filter({ hasText: /^qs_/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Revoke token' }).click();
    await expect(page.getByText('No script tokens.', { exact: true })).toBeVisible();
    expect([...mock.records.keys()].filter((key) => key.startsWith('api:'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(
      page.getByRole('heading', { name: 'Connect QuietScore to your AI tools' }),
    ).toBeVisible();
  } finally {
    await mock.close();
  }
});

test('browser consent shows callback host and starts a browser-bound GitHub sign-in', async ({
  page,
}) => {
  const mock = await authServer();
  try {
    const registration = await mock.call('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Browser fixture client',
        redirect_uris: ['https://client.test/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      }),
    });
    const client = (await registration.json()) as { client_id: string };
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'https://client.test/callback',
      response_type: 'code',
      scope: 'cvss:read',
      code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256',
      resource: mock.origin + '/mcp',
    });
    await page.goto(mock.origin + '/authorize?' + query);
    await expect(page.getByText('client.test', { exact: true })).toBeVisible();
    await expect(page.getByText(/name is not verified/)).toBeVisible();
    await page.getByRole('button', { name: 'Allow and sign in with GitHub' }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic GitHub sign-in' })).toBeVisible();
    await expect(page).toHaveURL(/\/synthetic-github\?/);
    expect(mock.githubRedirect?.origin).toBe('https://github.com');
    expect(mock.githubRedirect?.searchParams.get('scope')).toBe('');
    expect(mock.githubRedirect?.searchParams.get('code_challenge_method')).toBe('S256');
  } finally {
    await mock.close();
  }
});
