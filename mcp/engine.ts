export interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  input_ptr: () => number;
  output_ptr: () => number;
  run: (action: number, length: number) => number;
}
export type EngineResult = Record<string, unknown>;
export type EngineCall = (action: 10 | 11 | 12, input: string) => EngineResult;

/** Fresh WASM memory per calculation: no shared assessment state across MCP calls. */
export function createEngine(module: WebAssembly.Module): EngineCall {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (action, input) => {
    const bytes = encoder.encode(input);
    if (bytes.length > 8192) return { valid: false, error: 'Input exceeds the 8 KB limit.' };
    const engine = new WebAssembly.Instance(module, {}).exports as EngineExports;
    new Uint8Array(engine.memory.buffer, engine.input_ptr(), bytes.length).set(bytes);
    const size = engine.run(action, bytes.length);
    if (!size) throw new Error('Scoring engine failed.');
    return JSON.parse(decoder.decode(new Uint8Array(engine.memory.buffer, engine.output_ptr(), size))) as EngineResult;
  };
}
