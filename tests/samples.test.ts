import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const samples = JSON.parse(
  readFileSync(new URL('../samples.json', import.meta.url), 'utf8'),
) as Array<{
  id: string;
  published: string;
  score: number;
  vector: string;
  sources: Array<{ url: string }>;
  variation?: { score: number; vector: string };
}>;
const wasm = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(new URL('../generated/quietscore.wasm', import.meta.url))),
  {},
).exports as unknown as {
  memory: WebAssembly.Memory;
  input_ptr(): number;
  output_ptr(): number;
  run(action: number, length: number): number;
};
function calculate(vector: string) {
  const bytes = new TextEncoder().encode(vector);
  new Uint8Array(wasm.memory.buffer, wasm.input_ptr(), bytes.length).set(bytes);
  const length = wasm.run(10, bytes.length);
  return JSON.parse(
    new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), length)),
  );
}
test('ten attributed samples and mitigation variants match compiled Rust scores', () => {
  assert.equal(samples.length, 10);
  assert.equal(new Set(samples.map((s) => s.id)).size, 10);
  assert.equal(samples.filter((s) => s.published.startsWith('2026')).length, 9);
  for (const s of samples) {
    const result = calculate(s.vector);
    assert.equal(result.valid, true, s.id);
    assert.equal(result.score, s.score, s.id);
    assert.ok(s.sources.length >= 2);
    for (const source of s.sources) assert.equal(new URL(source.url).protocol, 'https:');
    if (s.variation) assert.equal(calculate(s.variation.vector).score, s.variation.score);
  }
  const log4j = samples.find((s) => s.id === 'CVE-2021-44228')!;
  assert.equal(log4j.published, '2021-12-10');
  assert.match(log4j.vector, /\/E:A$/);
});

test('all sample metrics have contextual evidence and source URLs', () => {
  const data = JSON.parse(readFileSync(new URL('../samples.json', import.meta.url), 'utf8'));
  for (const sample of data) {
    assert.equal(Object.keys(sample.metricContext).length, 32);
    for (const context of Object.values(sample.metricContext) as Array<{
      text: string;
      sources: string[];
      status: string;
    }>) {
      assert.ok(context.text.length > 20);
      assert.ok(context.status);
      assert.ok(context.sources.length);
    }
  }
});
