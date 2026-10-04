import { createMcpHandler } from '@modelcontextprotocol/server';
import wasm from '../generated/quietscore.wasm';
import { createEngine } from '../mcp/engine.ts';
import { createServer } from '../mcp/server.ts';
import { createWorker } from './router.ts';

const engine = createEngine(wasm);
// SDK owns protocol negotiation. One fresh server per request, no durable session.
const handler = createMcpHandler(() => createServer(engine), {
  legacy: 'stateless',
  responseMode: 'auto',
  maxSubscriptions: 0,
  onerror: () => {},
});
export default createWorker(handler);
