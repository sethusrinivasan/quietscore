export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  MCP_AUTH_TOKEN?: string;
  ALLOW_PUBLIC_MCP?: string;
  ALLOWED_ORIGINS?: string;
}
interface Handler {
  fetch(request: Request): Promise<Response>;
}
const MAX_BODY_BYTES = 32768;
const encoder = new TextEncoder();
function reply(message: string, status: number, extra: HeadersInit = {}): Response {
  return new Response(status === 204 ? null : message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}
async function equalToken(actual: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all(
    [actual, expected].map((s) => crypto.subtle.digest('SHA-256', encoder.encode(s))),
  );
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function boundedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export function createWorker(handler: Handler) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/healthz')
        return request.method === 'GET' || request.method === 'HEAD'
          ? reply(request.method === 'HEAD' ? '' : 'ok', 200)
          : reply('Method not allowed.', 405, { Allow: 'GET, HEAD' });
      if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') {
        if (url.pathname.startsWith('/mcp/')) return reply('Not found.', 404);
        return env.ASSETS.fetch(request);
      }
      // No assessment data in URLs, even from a misconfigured client.
      if (url.search) return reply('Query strings are not accepted on the MCP endpoint.', 400);
      const origin = request.headers.get('Origin');
      const allowed = [
        url.origin,
        ...(env.ALLOWED_ORIGINS ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ];
      if (origin && !allowed.includes(origin)) return reply('Origin not allowed.', 403);
      const cors: Record<string, string> = origin
        ? {
            'Access-Control-Allow-Origin': origin,
            Vary: 'Origin',
            'Access-Control-Expose-Headers': 'MCP-Protocol-Version, MCP-Session-Id',
          }
        : {};
      if (request.method === 'OPTIONS')
        return reply('', 204, {
          ...cors,
          'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':
            'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Method, MCP-Name, MCP-Session-Id',
        });
      if (!env.MCP_AUTH_TOKEN && env.ALLOW_PUBLIC_MCP !== 'true')
        return reply(
          'MCP is disabled until authentication or explicit public access is configured.',
          503,
          cors,
        );
      if (env.MCP_AUTH_TOKEN) {
        const authorization = request.headers.get('Authorization') ?? '';
        if (
          !authorization.startsWith('Bearer ') ||
          authorization.length > 4096 ||
          !(await equalToken(authorization.slice(7), env.MCP_AUTH_TOKEN))
        )
          return reply('Unauthorized.', 401, {
            ...cors,
            'WWW-Authenticate': 'Bearer realm="quietscore"',
          });
      }
      try {
        let bounded = request;
        if (request.method === 'POST') {
          const bytes = await boundedBody(request);
          if (!bytes) return reply('Request body exceeds 32 KB.', 413, cors);
          const headers = new Headers(request.headers);
          headers.delete('Content-Length');
          bounded = new Request(request.url, { method: 'POST', headers, body: bytes });
        }
        const response = await handler.fetch(bounded);
        const headers = new Headers(response.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      } catch {
        return reply('MCP request could not be processed.', 500, cors);
      }
    },
  };
}
