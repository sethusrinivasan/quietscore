import OAuthProvider, {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { createWorker, equalToken, type Env } from './router.ts';

export interface AuthEnv extends Env {
  OAUTH_KV?: CloudflareBindings['OAUTH_KV'];
  OAUTH_PROVIDER?: OAuthHelpers;
  PUBLIC_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}
class AuthInputError extends Error {}
interface Identity {
  userId: string;
  login: string;
}
interface Session extends Identity {
  csrf: string;
}
interface ApiToken {
  userId: string;
  name: string;
  expiresAt: number;
}
const SCOPE = 'cvss:read';
const SESSION_COOKIE = '__Host-quietscore-session';
const LOGIN_COOKIE = '__Host-quietscore-login';
const TTL = 8 * 60 * 60;
const random = () => crypto.randomUUID() + crypto.randomUUID();
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
export async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function challenge(verifier: string): Promise<string> {
  const hex = await digest(verifier);
  return btoa(String.fromCharCode(...hex.match(/../g)!.map((h) => parseInt(h, 16))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function cookie(request: Request, name: string): string {
  return (
    request.headers
      .get('Cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + '='))
      ?.slice(name.length + 1) ?? ''
  );
}
function setCookie(headers: Headers, name: string, value: string, maxAge: number): void {
  headers.append(
    'Set-Cookie',
    `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
  );
}
function page(
  title: string,
  body: string,
  status = 200,
  headers = new Headers(),
  formDestinations: string[] = [],
): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set(
    'Content-Security-Policy',
    `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formDestinations.join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
  );
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · QuietScore</title><style>html{color-scheme:light dark;font:17px/1.6 system-ui}body{max-width:650px;margin:5vh auto;padding:24px}h1{line-height:1.2}a{color:light-dark(#254bc4,#a8c2ff)}button{font:inherit;padding:10px 18px;border-radius:10px;cursor:pointer;margin:8px 8px 8px 0}input{font:inherit;padding:8px;max-width:90%}article{padding:16px;margin:12px 0;border:1px solid #888;border-radius:12px}code{overflow-wrap:anywhere}small{display:block}strong{overflow-wrap:anywhere}</style><header><a href="/">QuietScore</a> · <a href="/connect">MCP connections</a></header><main><h1>${escapeHtml(title)}</h1>${body}</main></html>`,
    { status, headers },
  );
}
function redirect(location: string, headers = new Headers()): Response {
  headers.set('Location', location);
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(null, { status: 302, headers });
}
function oauth(env: AuthEnv): OAuthHelpers {
  if (!env.OAUTH_PROVIDER) throw new Error('OAuth unavailable');
  return env.OAUTH_PROVIDER;
}
async function session(request: Request, env: AuthEnv): Promise<Session | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token || token.length > 200) return null;
  return env.OAUTH_KV!.get<Session>('session:' + (await digest(token)), 'json');
}
async function establishSession(identity: Identity, env: AuthEnv, headers: Headers): Promise<void> {
  const token = random();
  await env.OAUTH_KV!.put(
    'session:' + (await digest(token)),
    JSON.stringify({ ...identity, csrf: random() }),
    { expirationTtl: TTL },
  );
  setCookie(headers, SESSION_COOKIE, token, TTL);
}
function githubUrl(env: AuthEnv, state: string, codeChallenge: string, callback: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID!,
    redirect_uri: env.PUBLIC_URL! + callback,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: '',
  }).toString();
  return url.href;
}
async function githubIdentity(
  request: Request,
  env: AuthEnv,
  verifier: string,
  callback: string,
): Promise<Identity> {
  const code = new URL(request.url).searchParams.get('code');
  if (!code || code.length > 512) throw new Error('Sign-in failed');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      code,
      code_verifier: verifier,
      redirect_uri: env.PUBLIC_URL! + callback,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const token = (await response.json()) as { access_token?: string };
  if (!response.ok || !token.access_token) throw new Error('Sign-in failed');
  const user = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: 'Bearer ' + token.access_token,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'QuietScore',
    },
    signal: AbortSignal.timeout(10000),
  });
  const identity = (await user.json()) as { id?: number; login?: string };
  if (!user.ok || !Number.isSafeInteger(identity.id) || !identity.login)
    throw new Error('Sign-in failed');
  // The GitHub credential is used only for this identity lookup, never persisted or passed to MCP clients.
  return { userId: 'github-' + identity.id, login: identity.login };
}
async function formData(request: Request): Promise<URLSearchParams> {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))
    throw new AuthInputError('Invalid form');
  const reader = request.body?.getReader();
  let text = '';
  let length = 0;
  const decoder = new TextDecoder();
  if (reader)
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8192) {
          await reader.cancel();
          throw new AuthInputError('Form too large');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  return new URLSearchParams(text);
}
async function checkedForm(
  request: Request,
  env: AuthEnv,
  current: Session,
): Promise<URLSearchParams> {
  if (request.headers.get('Origin') !== env.PUBLIC_URL) throw new AuthInputError('Origin mismatch');
  const form = await formData(request);
  if ((await digest(form.get('csrf') ?? '')) !== (await digest(current.csrf)))
    throw new AuthInputError('Invalid form');
  return form;
}
export async function validApiToken(token: string, env: AuthEnv): Promise<boolean> {
  if (!/^qs_[a-f0-9]{64}$/.test(token)) return false;
  const record = await env.OAUTH_KV!.get<ApiToken>('api:' + (await digest(token)), 'json');
  return !!record && record.expiresAt > Date.now();
}
async function connectionPage(
  request: Request,
  env: AuthEnv,
  current: Session,
  issued?: string,
): Promise<Response> {
  const grants = await oauth(env).listUserGrants(current.userId, { limit: 100 });
  const tokens = await env.OAUTH_KV!.list({ prefix: `user-api:${current.userId}:`, limit: 100 });
  const csrf = `<input type="hidden" name="csrf" value="${escapeHtml(current.csrf)}">`;
  const records = await Promise.all(
    tokens.keys.map(async (key) => {
      const record = await env.OAUTH_KV!.get<ApiToken>(key.name, 'json');
      if (!record) return '';
      return `<article><strong>${escapeHtml(record.name)}</strong><small>Expires ${new Date(record.expiresAt).toISOString().slice(0, 10)}</small><form method="post" action="/connect/token/revoke">${csrf}<input type="hidden" name="id" value="${key.name.split(':').at(-1)}"><button>Revoke token</button></form></article>`;
    }),
  );
  const grantHtml = await Promise.all(
    grants.items.map(async (grant) => {
      const client = await oauth(env).lookupClient(grant.clientId);
      return `<article><strong>${escapeHtml(client?.clientName ?? grant.clientId)}</strong><small>${escapeHtml(grant.scope.join(', '))}</small><form method="post" action="/connect/revoke">${csrf}<input type="hidden" name="id" value="${escapeHtml(grant.id)}"><button>Revoke connection</button></form></article>`;
    }),
  );
  return page(
    'Your MCP connections',
    `<p>Signed in as <strong>${escapeHtml(current.login)}</strong>.</p><p>Connect an OAuth-capable AI client to <code>${escapeHtml(env.PUBLIC_URL!)}/mcp</code>. Scoring and explanations only; your local drafts are never accessible.</p>${issued ? `<article><strong>Copy your token now. It is shown once.</strong><p><code>${escapeHtml(issued)}</code></p><p>Use <code>Authorization: Bearer TOKEN</code>. Keep it private.</p></article>` : ''}<h2>AI clients</h2>${grantHtml.join('') || '<p>No connected clients.</p>'}${grants.cursor ? '<p>Additional connections exist. Revoke listed connections and reload to see more.</p>' : ''}<h2>Script tokens</h2>${records.join('') || '<p>No script tokens.</p>'}${!tokens.list_complete ? '<p>Additional tokens exist. Revoke listed tokens and reload to see more.</p>' : ''}<form method="post" action="/connect/token">${csrf}<label>Token name <input name="name" maxlength="60" required placeholder="My automation"></label><p>Expires in 30 days. Only the token hash is stored.</p><button>Create API token</button></form><form method="post" action="/connect/logout">${csrf}<button>Sign out</button></form>`,
  );
}
async function authRoutes(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const ready = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
  if (!ready)
    return page(
      'Sign-in setup pending',
      '<p>GitHub sign-in has not been activated by the site owner. The calculator remains available without an account.</p>',
      503,
    );
  if (url.pathname === '/authorize' && request.method === 'GET') {
    const auth = await oauth(env).parseAuthRequest(request);
    const details = await oauth(env).describeConsent(auth);
    const consent = await oauth(env).beginConsent(auth);
    return page(
      'Connect your AI client',
      `<p><strong>${escapeHtml(details.clientName)}</strong> wants to use QuietScore.</p><p>${details.clientDomain ? 'Published by ' + escapeHtml(details.clientDomain) : 'This client supplied its own name; the name is not verified.'}</p><p>Access returns to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? '<p>Access goes to an app on your computer. Continue only if you started this connection.</p>' : ''}<p>Allow CVSS scoring, metric definitions, and explanations. This cannot read your browser drafts or files.</p><p>Hosted requests are processed on Cloudflare without assessment storage. GitHub is used only to identify you; no repository or email permissions are requested.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(consent.handle)}"><button name="decision" value="approve">Allow and sign in with GitHub</button><button name="decision" value="deny">Deny</button></form>`,
      200,
      consent.headers,
      ['https://github.com', new URL(auth.redirectUri).origin],
    );
  }
  if (url.pathname === '/authorize' && request.method === 'POST') {
    const form = await formData(request);
    if (form.get('decision') !== 'approve') {
      const denied = await oauth(env).denyConsent(request, form.get('handle') ?? '');
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth(env).approveConsent(request, form.get('handle') ?? '', {
      scope: [SCOPE],
    });
    const verifier = random();
    const upstream = await oauth(env).beginUpstream(approved.request, {
      data: { verifier },
      headers: approved.headers,
    });
    return redirect(
      githubUrl(env, upstream.state, await challenge(verifier), '/auth/callback'),
      upstream.headers,
    );
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const upstream = await oauth(env).finishUpstream<{ verifier: string }>(request);
    if (url.searchParams.has('error'))
      return redirect(
        authorizationErrorRedirect(upstream.request, 'access_denied'),
        upstream.headers,
      );
    const identity = await githubIdentity(request, env, upstream.data.verifier, '/auth/callback');
    const result = await oauth(env).completeAuthorization({
      request: upstream.request,
      userId: identity.userId,
      metadata: {},
      scope: [SCOPE],
      props: { userId: identity.userId },
    });
    await establishSession(identity, env, upstream.headers);
    return redirect(result.redirectTo, upstream.headers);
  }
  if (url.pathname === '/connect/login' && request.method === 'GET') {
    const state = random();
    const binding = random();
    const verifier = random();
    await env.OAUTH_KV!.put(
      'login:' + (await digest(state)),
      JSON.stringify({ binding: await digest(binding), verifier }),
      { expirationTtl: 600 },
    );
    const headers = new Headers();
    setCookie(headers, LOGIN_COOKIE, binding, 600);
    return redirect(
      githubUrl(env, state, await challenge(verifier), '/auth/account-callback'),
      headers,
    );
  }
  if (url.pathname === '/auth/account-callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') ?? '';
    if (state.length > 200) throw new AuthInputError('Invalid state');
    const key = 'login:' + (await digest(state));
    const login = await env.OAUTH_KV!.get<{ binding: string; verifier: string }>(key, 'json');
    if (!login || login.binding !== (await digest(cookie(request, LOGIN_COOKIE))))
      throw new AuthInputError('Invalid state');
    await env.OAUTH_KV!.delete(key);
    const identity = await githubIdentity(request, env, login.verifier, '/auth/account-callback');
    const headers = new Headers();
    setCookie(headers, LOGIN_COOKIE, '', 0);
    await establishSession(identity, env, headers);
    return redirect('/connect', headers);
  }
  const current = await session(request, env);
  if (url.pathname === '/connect' && request.method === 'GET') {
    if (!current)
      return page(
        'Connect QuietScore to your AI tools',
        `<p>Use this MCP endpoint in your AI client:</p><p><code>${escapeHtml(env.PUBLIC_URL!)}/mcp</code></p><p>Your AI client opens a consent screen and GitHub sign-in. For scripts, sign in here to create individual API tokens.</p><p><a href="/connect/login">Sign in with GitHub</a></p><p>The calculator needs no account. Authentication stores identity and access records only; assessments are never stored.</p>`,
      );
    return connectionPage(request, env, current);
  }
  if (!current)
    return page('Sign in required', '<p><a href="/connect">Return to connections</a></p>', 401);
  if (request.method !== 'POST') return page('Not found', '', 404);
  const form = await checkedForm(request, env, current);
  if (url.pathname === '/connect/logout') {
    await env.OAUTH_KV!.delete('session:' + (await digest(cookie(request, SESSION_COOKIE))));
    const headers = new Headers();
    setCookie(headers, SESSION_COOKIE, '', 0);
    return redirect('/connect', headers);
  }
  if (url.pathname === '/connect/revoke') {
    await oauth(env).revokeGrant(form.get('id') ?? '', current.userId);
    return redirect('/connect');
  }
  if (url.pathname === '/connect/token') {
    const name = (form.get('name') ?? '').trim();
    if (!name || name.length > 60) throw new AuthInputError('Invalid token name');
    const token = 'qs_' + (await digest(random()));
    const id = await digest(token);
    const record: ApiToken = {
      userId: current.userId,
      name,
      expiresAt: Date.now() + 30 * 86400000,
    };
    const options = { expirationTtl: 30 * 86400 };
    await env.OAUTH_KV!.put('api:' + id, JSON.stringify(record), options);
    await env.OAUTH_KV!.put(`user-api:${current.userId}:${id}`, JSON.stringify(record), options);
    return connectionPage(request, env, current, token);
  }
  if (url.pathname === '/connect/token/revoke') {
    const id = form.get('id') ?? '';
    if (!/^[a-f0-9]{64}$/.test(id)) throw new AuthInputError('Invalid token');
    const record = await env.OAUTH_KV!.get<ApiToken>('api:' + id, 'json');
    if (record?.userId !== current.userId) throw new AuthInputError('Invalid token');
    await env.OAUTH_KV!.delete('api:' + id);
    await env.OAUTH_KV!.delete(`user-api:${current.userId}:${id}`);
    return redirect('/connect');
  }
  return page('Not found', '', 404);
}
export function createAuthenticatedWorker(handler: { fetch(request: Request): Promise<Response> }) {
  const router = createWorker(handler);
  return {
    async fetch(request: Request, env: AuthEnv, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const isMcp = url.pathname === '/mcp' || url.pathname === '/mcp/';
      const isAuth =
        url.pathname === '/authorize' ||
        url.pathname.startsWith('/auth/') ||
        url.pathname === '/connect' ||
        url.pathname.startsWith('/connect/') ||
        url.pathname.startsWith('/oauth/') ||
        url.pathname.startsWith('/.well-known/');
      if (!isMcp && !isAuth) return router.fetch(request, env);
      if (!env.OAUTH_KV || !env.PUBLIC_URL) {
        if (isMcp) return router.fetch(request, env);
        return page(
          'Sign-in setup pending',
          '<p>The site owner needs to configure OAuth. The calculator remains available.</p>',
          503,
        );
      }
      if (url.origin !== env.PUBLIC_URL) return page('Invalid host', '', 400);
      if (isMcp && request.method === 'OPTIONS') return router.fetch(request, env);
      // Script tokens and the existing migration token use the same body/origin safeguards.
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      if (isMcp && token.startsWith('qs_') && (await validApiToken(token, env)))
        return router.fetch(request, {
          ...env,
          MCP_AUTH_TOKEN: undefined,
          ALLOW_PUBLIC_MCP: 'true',
        });
      if (isMcp && env.MCP_AUTH_TOKEN && (await equalToken(token, env.MCP_AUTH_TOKEN)))
        return router.fetch(request, env);
      const provider = new OAuthProvider<AuthEnv>({
        apiRoute: '/mcp',
        apiHandler: {
          fetch: (req, bindings) =>
            router.fetch(req, { ...bindings, MCP_AUTH_TOKEN: undefined, ALLOW_PUBLIC_MCP: 'true' }),
        },
        defaultHandler: { fetch: authRoutes },
        authorizeEndpoint: '/authorize',
        tokenEndpoint: '/oauth/token',
        clientRegistrationEndpoint: '/oauth/register',
        accessTokenTTL: 900,
        refreshTokenTTL: 30 * 86400,
        scopesSupported: [SCOPE],
        requiredScopes: [SCOPE],
        clientIdMetadataDocumentEnabled: true,
        onError: (error) =>
          new Response(
            JSON.stringify({ error: error.code, error_description: error.description }),
            {
              status: error.status,
              headers: {
                ...error.headers,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
              },
            },
          ),
        resourceMetadata: {
          resource: env.PUBLIC_URL + '/mcp',
          authorization_servers: [env.PUBLIC_URL],
          resource_name: 'QuietScore CVSS tools',
        },
      });
      try {
        return await provider.fetch(request, env, ctx);
      } catch (error) {
        if (error instanceof AuthorizationError && error.redirectTo)
          return redirect(error.redirectTo);
        return page(
          'Connection could not be completed',
          error instanceof AuthorizationError || error instanceof CimdFetchError
            ? '<p>This authorization request is invalid or has expired. Start again from your AI client.</p>'
            : '<p>Please restart sign-in. No assessment data has been saved.</p>',
          error instanceof AuthorizationError ||
            error instanceof CimdFetchError ||
            error instanceof AuthInputError
            ? 400
            : 503,
        );
      }
    },
  };
}
