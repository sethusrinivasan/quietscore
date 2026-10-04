import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import packageInfo from '../package.json';
import type { EngineCall, EngineResult } from './engine.ts';

const metrics = [
  'AV',
  'AC',
  'AT',
  'PR',
  'UI',
  'VC',
  'VI',
  'VA',
  'SC',
  'SI',
  'SA',
  'E',
  'CR',
  'IR',
  'AR',
  'MAV',
  'MAC',
  'MAT',
  'MPR',
  'MUI',
  'MVC',
  'MVI',
  'MVA',
  'MSC',
  'MSI',
  'MSA',
  'S',
  'AU',
  'R',
  'V',
  'RE',
  'U',
] as const;
const vectorSchema = z
  .object({
    vector: z
      .string()
      .min(1)
      .max(8192)
      .describe('A complete CVSS:4.0 vector; all 11 Base metrics are required.'),
  })
  .strict();
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
function result(data: EngineResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    structuredContent: data,
    ...(data.valid === false ? { isError: true } : {}),
  };
}
export function createServer(engine: EngineCall): McpServer {
  const server = new McpServer({ name: 'quietscore', version: packageInfo.version });
  server.registerTool(
    'cvss_calculate',
    {
      title: 'Calculate CVSS 4.0 severity',
      description:
        'Validate and canonicalize a CVSS 4.0 vector and calculate its score using the FIRST reference algorithm in Rust/WebAssembly. Optional Threat and Environmental metrics affect scoring; Supplemental metrics do not. Severity is not complete business risk.',
      inputSchema: vectorSchema,
      annotations,
    },
    ({ vector }) => result(engine(10, vector)),
  );
  server.registerTool(
    'cvss_explain',
    {
      title: 'Explain a CVSS 4.0 assessment',
      description:
        'Calculate a CVSS 4.0 assessment and explain all 32 metric selections, defaults, and effective values. Guidance is a plain-language interpretation of FIRST’s specification, not an independent severity standard.',
      inputSchema: vectorSchema,
      annotations,
    },
    ({ vector }) => result(engine(11, vector)),
  );
  server.registerTool(
    'cvss_metric',
    {
      title: 'Explain CVSS 4.0 metric classifications',
      description:
        'Describe one CVSS 4.0 metric, its group, allowed classifications, and whether it changes the score. Uses bundled FIRST-based guidance; no external lookup.',
      inputSchema: z.object({ metric: z.enum(metrics) }).strict(),
      annotations,
    },
    ({ metric }) => result(engine(12, metric)),
  );
  return server;
}
