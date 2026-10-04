import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest, escapeHtml } from '../worker/auth.ts';
import { fixture } from './fixtures/auth.ts';

function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function register(call: ReturnType<typeof fixture>['call']) {
  const response = await call('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: '<script>evil</script>',
      redirect_uris: ['https://client.test/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { client_id: string }).client_id;
}
async function authorize(call: ReturnType<typeof fixture>['call'], client: string) {
  const verifier = 'v'.repeat(64);
  const hex = await digest(verifier);
  const challenge = Buffer.from(hex, 'hex').toString('base64url');
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: 'https://client.test/callback',
    response_type: 'code',
    scope: 'cvss:read',
    state: 'client-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: 'https://quietscore.test/mcp',
  });
  const response = await call('/authorize?' + params);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!html.includes('<script>evil</script>'));
  assert.ok(html.includes('&#60;script&#62;evil'));
  assert.ok(html.includes('client.test'));
  assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  assert.match(
    response.headers.get('Content-Security-Policy')!,
    /form-action 'self' https:\/\/github.com https:\/\/client.test/,
  );
  assert.match(response.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
  return {
    verifier,
    handle: html.match(/name="handle" value="([^"]+)"/)![1],
    cookie: cookies(response),
  };
}
const form = (values: Record<string, string>, cookie = ''): RequestInit => ({
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://quietscore.test',
    Cookie: cookie,
  },
  body: new URLSearchParams(values),
});

test('OAuth discovery and login keep calculator anonymous and fail closed without configuration', async () => {
  const { call, env } = fixture();
  assert.equal(await (await call('/')).text(), 'calculator');
  const denied = await call('/mcp');
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('WWW-Authenticate')!, /resource_metadata/);
  const metadata = (await (await call('/.well-known/oauth-authorization-server')).json()) as {
    code_challenge_methods_supported: string[];
  };
  assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
  assert.equal((await call('/connect')).status, 200);
  delete env.GITHUB_CLIENT_SECRET;
  assert.equal((await call('/connect')).status, 503);
});

test('consent rejects missing browser cookie, dangerous redirects, absent PKCE, and forgery; Deny returns OAuth error', async () => {
  const { call } = fixture();
  const client = await register(call);
  assert.equal(
    (await call(`/authorize?client_id=${client}&redirect_uri=https://evil.test&response_type=code`))
      .status,
    400,
  );
  const noPkce = await call(
    `/authorize?client_id=${client}&redirect_uri=https://client.test/callback&response_type=code`,
  );
  assert.notEqual(noPkce.status, 200);
  const consent = await authorize(call, client);
  assert.equal(
    (await call('/authorize', form({ handle: consent.handle, decision: 'approve' }))).status,
    400,
  );
  const denied = await call(
    '/authorize',
    form({ handle: consent.handle, decision: 'deny' }, consent.cookie),
  );
  assert.equal(denied.status, 302);
  const target = new URL(denied.headers.get('Location')!);
  assert.equal(target.origin, 'https://client.test');
  assert.equal(target.searchParams.get('error'), 'access_denied');
  assert.equal(target.searchParams.get('state'), 'client-state');
});

test('GitHub PKCE login issues audience-bound MCP tokens, refreshes and revokes them without storing GitHub credentials', async () => {
  const { call, records } = fixture();
  const client = await register(call);
  const consent = await authorize(call, client);
  const approved = await call(
    '/authorize',
    form({ handle: consent.handle, decision: 'approve' }, consent.cookie),
  );
  const upstream = new URL(approved.headers.get('Location')!);
  assert.equal(upstream.origin, 'https://github.com');
  assert.equal(upstream.searchParams.get('scope'), '');
  assert.equal(upstream.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    (await call('/auth/callback?code=example&state=' + upstream.searchParams.get('state'))).status,
    400,
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/access_token')) {
      assert.ok(String(init?.body).includes('code_verifier='));
      return Response.json({ access_token: 'synthetic-upstream-secret' });
    }
    return Response.json({ id: 123, login: 'test-user' });
  };
  try {
    const callback = await call(
      '/auth/callback?code=example&state=' + upstream.searchParams.get('state'),
      { headers: { Cookie: cookies(approved) } },
    );
    assert.equal(callback.status, 302);
    const target = new URL(callback.headers.get('Location')!);
    assert.equal(target.searchParams.get('state'), 'client-state');
    const exchange = (values: Record<string, string>) =>
      call(
        '/oauth/token',
        form({ client_id: client, resource: 'https://quietscore.test/mcp', ...values }),
      );
    const wrong = await exchange({
      grant_type: 'authorization_code',
      code: target.searchParams.get('code')!,
      code_verifier: 'wrong',
    });
    assert.equal(wrong.status, 400);
    const tokenResponse = await exchange({
      grant_type: 'authorization_code',
      code: target.searchParams.get('code')!,
      code_verifier: consent.verifier,
    });
    assert.equal(tokenResponse.status, 200);
    const token = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    assert.equal(token.expires_in, 900);
    assert.equal(
      await (
        await call('/mcp', { headers: { Authorization: 'Bearer ' + token.access_token } })
      ).text(),
      'scored',
    );
    assert.equal(
      (
        await exchange({
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token,
          resource: 'https://other.test/mcp',
        })
      ).status,
      400,
    );
    const refreshed = await exchange({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    });
    assert.equal(refreshed.status, 200);
    const sessionCookie = cookies(callback);
    const connections = await call('/connect', { headers: { Cookie: sessionCookie } });
    const html = await connections.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
    const grant = html.match(/name="id" value="([^"]+)"/)![1];
    assert.equal(
      (await call('/connect/revoke', form({ csrf, id: grant }, sessionCookie))).status,
      302,
    );
    assert.equal(
      (await call('/mcp', { headers: { Authorization: 'Bearer ' + token.access_token } })).status,
      401,
    );
    assert.ok([...records.values()].every((value) => !value.includes('synthetic-upstream-secret')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('script tokens are hashed, scoped to their owner, expire, and require CSRF for creation and revocation', async () => {
  const { call, records } = fixture();
  const session = 'synthetic-session';
  records.set(
    'session:' + (await digest(session)),
    JSON.stringify({ userId: 'github-123', login: 'user', csrf: 'test-csrf' }),
  );
  const cookie = '__Host-quietscore-session=' + session;
  assert.equal(
    (await call('/connect/token', form({ name: 'script', csrf: 'wrong' }, cookie))).status,
    400,
  );
  const issued = await call(
    '/connect/token',
    form({ name: 'My script', csrf: 'test-csrf' }, cookie),
  );
  assert.equal(issued.status, 200);
  const token = (await issued.text()).match(/qs_[a-f0-9]{64}/)![0];
  assert.ok([...records.values()].every((value) => !value.includes(token)));
  assert.equal(
    await (await call('/mcp', { headers: { Authorization: 'Bearer ' + token } })).text(),
    'scored',
  );
  const id = await digest(token);
  records.set(
    'session:' + (await digest('other')),
    JSON.stringify({ userId: 'github-456', login: 'other', csrf: 'other-csrf' }),
  );
  assert.equal(
    (
      await call(
        '/connect/token/revoke',
        form({ id, csrf: 'other-csrf' }, '__Host-quietscore-session=other'),
      )
    ).status,
    400,
  );
  assert.equal(
    (await call('/connect/token/revoke', form({ id, csrf: 'test-csrf' }, cookie))).status,
    302,
  );
  assert.equal((await call('/mcp', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  records.set(
    'api:' + id,
    JSON.stringify({ userId: 'github-123', name: 'expired', expiresAt: Date.now() - 1 }),
  );
  assert.equal((await call('/mcp', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  assert.equal(escapeHtml('<a "x">'), '&#60;a &#34;x&#34;&#62;');
});
