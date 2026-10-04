import { readFile } from 'node:fs/promises';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createEngine } from './engine.ts';
import { createServer } from './server.ts';

const module = await WebAssembly.compile(
  await readFile(new URL('../generated/quietscore.wasm', import.meta.url)),
);
const engine = createEngine(module);
// stdout is reserved for MCP protocol messages. No assessment or diagnostic logs.
serveStdio(() => createServer(engine));
