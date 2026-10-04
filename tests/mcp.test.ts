import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createEngine } from '../mcp/engine.ts';
import { createServer } from '../mcp/server.ts';
import { createWorker, type Env } from '../worker/router.ts';

const data = (result: unknown): Record<string, unknown> => (result as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
const vector = 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N';
const module = await WebAssembly.compile(await readFile(new URL('../generated/quietscore.wasm', import.meta.url)));
const engine = createEngine(module);
const env: Env = { MCP_AUTH_TOKEN: 'test-token-only-not-a-real-secret', ASSETS: { async fetch() { return new Response('static asset'); } } };

for (const mode of ['legacy', 'auto'] as const) {
  test(`HTTP MCP ${mode}: discover/list/calculate/explain/classifications and invalid input`, async () => {
    const handler = createMcpHandler(() => createServer(engine), { legacy: 'stateless', maxSubscriptions: 0, onerror: () => {} });
    const worker = createWorker(handler);
    const client = new Client({ name: 'quietscore-test', version: '1.0.0' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(new URL('https://quietscore.test/mcp'), {
      requestInit: { headers: { Authorization: `Bearer ${env.MCP_AUTH_TOKEN}` } },
      fetch: (input, init) => worker.fetch(new Request(input as RequestInfo, init), env),
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map(t => t.name).sort(), ['cvss_calculate', 'cvss_explain', 'cvss_metric']);
      assert.ok(tools.tools.every(t => t.annotations?.readOnlyHint));
      const calculated = await client.callTool({ name: 'cvss_calculate', arguments: { vector } });
      assert.equal(data(calculated).score, 7.6);
      assert.equal(data(calculated).severity, 'High');
      assert.equal(data(calculated).vector, vector);
      const explanation = await client.callTool({ name: 'cvss_explain', arguments: { vector: vector + '/E:U/MSI:S/U:Red' } });
      const metrics = data(explanation).metrics as Array<Record<string, unknown>>;
      assert.equal(metrics.length, 32);
      assert.equal(metrics.find(m => m.metric === 'SI')?.effectiveValue, 'S');
      assert.equal(metrics.find(m => m.metric === 'U')?.affectsScore, false);
      const described = await client.callTool({ name: 'cvss_metric', arguments: { metric: 'AT' } });
      assert.equal(data(described).group, 'Base');
      assert.ok((data(described).options as Array<Record<string, unknown>>).some(o => o.value === 'P'));
      const invalid = await client.callTool({ name: 'cvss_calculate', arguments: { vector: vector + '/AV:N' } });
      assert.equal(invalid.isError, true);
      assert.equal(data(invalid).valid, false);
      const next = await client.callTool({ name: 'cvss_calculate', arguments: { vector } });
      assert.equal(data(next).score, 7.6);
    } finally { await client.close(); await handler.close(); }
  });
}

test('local stdio is an actual MCP server backed by the same WASM', async () => {
  const client = new Client({ name: 'quietscore-stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'mcp/stdio.ts'], cwd: fileURLToPath(new URL('..', import.meta.url)), stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools(); assert.equal(tools.tools.length, 3);
    const result = await client.callTool({ name: 'cvss_calculate', arguments: { vector } });
    assert.equal(data(result).score, 7.6);
  } finally { await client.close(); }
});

test('fresh WASM call state, defaults, and robust JSON errors', () => {
  const before = engine(10, vector);
  assert.equal(engine(10, vector + '/E:U').valid, true);
  assert.deepEqual(engine(10, vector), before);
  assert.equal(engine(10, vector + '/UI:"\n').valid, false);
  assert.equal(engine(10, vector.replace('/AT:P', '')).valid, false);
  assert.equal(engine(12, 'UNKNOWN').valid, false);
  const explanation = engine(11, vector);
  const metrics = explanation.metrics as Array<Record<string, unknown>>;
  assert.equal(metrics.find(m => m.metric === 'E')?.effectiveValue, 'A');
  assert.equal(metrics.find(m => m.metric === 'CR')?.effectiveValue, 'H');
});

test('Worker protects remote MCP while serving the calculator separately', async () => {
  const handler = createMcpHandler(() => createServer(engine), { onerror: () => {} });
  const worker = createWorker(handler);
  const request = (path: string, options: RequestInit = {}) => new Request('https://quietscore.test' + path, options);
  const headers = { Authorization: `Bearer ${env.MCP_AUTH_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  try {
    assert.equal(await (await worker.fetch(request('/'), env)).text(), 'static asset');
    assert.equal((await worker.fetch(request('/healthz'), env)).status, 200);
    assert.equal((await worker.fetch(request('/mcp'), { ASSETS: env.ASSETS })).status, 503);
    assert.equal((await worker.fetch(request('/mcp'), env)).status, 401);
    assert.equal((await worker.fetch(request('/mcp', { headers: { Authorization: 'Bearer wrong' } }), env)).status, 401);
    assert.equal((await worker.fetch(request('/mcp?vector=secret', { headers }), env)).status, 400);
    assert.equal((await worker.fetch(request('/mcp', { headers: { ...headers, Origin: 'https://other.test' } }), env)).status, 403);
    const preflight = await worker.fetch(request('/mcp', { method: 'OPTIONS', headers: { Origin: 'https://quietscore.test' } }), env);
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://quietscore.test');
    assert.equal((await worker.fetch(request('/mcp', { headers }), env)).status, 405);
    assert.equal((await worker.fetch(request('/mcp/unknown', { headers }), env)).status, 404);
    assert.equal((await worker.fetch(request('/mcp', { method: 'POST', headers, body: 'x'.repeat(40000) }), env)).status, 413);
    assert.equal((await worker.fetch(request('/mcp', { method: 'POST', headers: { ...headers, 'Content-Length': '999999' }, body: '{}' }), env)).status, 413);
    assert.equal((await worker.fetch(request('/mcp', { method: 'POST', headers, body: '{' }), env)).status, 400);
    const response = await worker.fetch(request('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), { ASSETS: env.ASSETS, ALLOW_PUBLIC_MCP: 'true' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(response.headers.get('Mcp-Session-Id'), null);
  } finally { await handler.close(); }
});
