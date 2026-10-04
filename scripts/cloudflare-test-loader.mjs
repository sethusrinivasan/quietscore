// Node unit tests use exported fetch handlers. The provider imports this base class
// only to recognize class-based handlers; Worker runtime checks use Wrangler separately.
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers')
    return { url: 'data:text/javascript,export class WorkerEntrypoint {}', shortCircuit: true };
  return nextResolve(specifier, context);
}
