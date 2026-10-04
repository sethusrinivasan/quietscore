import { createAuthenticatedWorker, type AuthEnv } from '../../worker/auth.ts';

export function fixture() {
  const records = new Map<string, string>();
  const kv = {
    async get(key: string, options?: string | { type?: string }) {
      const value = records.get(key) ?? null;
      return (typeof options === 'string' ? options : options?.type) === 'json' && value
        ? JSON.parse(value)
        : value;
    },
    async put(key: string, value: string) {
      records.set(key, value);
    },
    async delete(key: string) {
      records.delete(key);
    },
    async list(options: { prefix?: string } = {}) {
      return {
        keys: [...records.keys()]
          .filter((name) => name.startsWith(options.prefix ?? ''))
          .map((name) => ({ name })),
        list_complete: true,
        cursor: '',
      };
    },
  } as unknown as KVNamespace;
  const env: AuthEnv = {
    OAUTH_KV: kv,
    PUBLIC_URL: 'https://quietscore.test',
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'synthetic-secret',
    ASSETS: { fetch: async () => new Response('calculator') },
  };
  const worker = createAuthenticatedWorker({ fetch: async () => new Response('scored') });
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(env.PUBLIC_URL + path, init), env, ctx);
  return { env, records, call };
}

export { digest } from '../../worker/auth.ts';
