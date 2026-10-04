import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Exercise the browser API boundary with the real compiled Rust engine.
function fixture() {
  const source = readFileSync(new URL('../bridge.js', import.meta.url), 'utf8');
  const wasm = new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(new URL('../generated/quietscore.wasm', import.meta.url))),
    {},
  ).exports as unknown as {
    memory: WebAssembly.Memory;
    input_ptr(): number;
    output_ptr(): number;
    run(action: number, length: number): number;
  };
  const vector = 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N';
  function call(action: number, input = '') {
    if (action === 7) return vector;
    const bytes = new TextEncoder().encode(input);
    new Uint8Array(wasm.memory.buffer, wasm.input_ptr(), bytes.length).set(bytes);
    const length = wasm.run(action, bytes.length);
    return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, wasm.output_ptr(), length));
  }
  const storage = new Map<string, string>();
  let printed = 0;
  let downloaded: Uint8Array | undefined;
  const report = { innerHTML: '', focus() {} };
  const context = createContext({
    SAMPLES: [],
    call,
    engine: wasm,
    enc: new TextEncoder(),
    download(bytes: Uint8Array) {
      downloaded = bytes;
    },
    root: {
      addEventListener() {},
      querySelector() {
        return null;
      },
    },
    localStorage: {
      getItem(key: string) {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        storage.set(key, value);
      },
    },
    document: {
      getElementById() {
        return report;
      },
    },
    window: {
      print() {
        printed++;
      },
    },
    toast() {},
    paint() {},
  });
  runInContext(
    source.slice(
      source.indexOf('// BROWSER_FEATURES_BEGIN'),
      source.indexOf('// ENGINE_BOOTSTRAP'),
    ),
    context,
  );
  return {
    context,
    storage,
    report,
    get printed() {
      return printed;
    },
    get downloaded() {
      return downloaded;
    },
  };
}
test('local drafts retain multiple records and fail clearly on damaged/blocked storage', () => {
  const f = fixture();
  runInContext(
    `writeDrafts([{id:'one',title:'First',notes:'Evidence',vector:call(7),reviewed:['AV'],step:1,guided:true,updated:new Date().toISOString()},{id:'two',title:'Second',notes:'',vector:call(7),reviewed:[],step:0,guided:false,updated:new Date().toISOString()}])`,
    f.context,
  );
  assert.equal(runInContext('readDrafts().length', f.context), 2);
  assert.equal(runInContext('readDrafts()[0].step', f.context), 1);
  f.storage.set('quietscore.drafts.v1', 'not json');
  assert.throws(() => runInContext('readDrafts()', f.context), /unavailable/);
  f.storage.set('quietscore.drafts.v1', '[{}]');
  assert.throws(() => runInContext('readDrafts()', f.context), /unsupported/);
  runInContext(`localStorage.setItem=()=>{throw Error('quota')}`, f.context);
  assert.throws(() => runInContext('writeDrafts([])', f.context), /could not be saved/);
});
test('PDF report uses Rust classifications, escapes scenario text, and flags incomplete Base review', () => {
  const f = fixture();
  runInContext(
    `scenario.title='<script>unsafe</script>';scenario.notes='<img src=x>';wizard=2;exportPdf()`,
    f.context,
  );
  assert.equal(f.printed, 1);
  assert.match(f.report.innerHTML, /7\.6 \/ 10 · High/);
  assert.match(f.report.innerHTML, /Provisional/);
  assert.match(f.report.innerHTML, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(f.report.innerHTML, /<script>|<img /);
  assert.equal((f.report.innerHTML.match(/<section>/g) || []).length, 32);
  assert.match(f.report.innerHTML, /first.org\/cvss/);
});

test('read-only samples reject edits and cloning preserves attribution while creating unsaved editable work', () => {
  const f = fixture();
  runInContext(
    "scenario={id:null,sampleId:'CVE-2021-44228',title:'Log4Shell',notes:'FIRST source'};readOnly=true;dirty=false",
    f.context,
  );
  assert.throws(() => runInContext('assertEditable()', f.context), /read-only/);
  assert.equal(
    runInContext('call(7)', f.context),
    'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N',
  );
  runInContext('cloneCurrentSample();assertEditable()', f.context);
  assert.equal(runInContext('readOnly', f.context), false);
  assert.equal(runInContext('dirty', f.context), true);
  assert.equal(runInContext('scenario.id', f.context), null);
  assert.equal(runInContext('scenario.sampleId', f.context), 'CVE-2021-44228');
  assert.equal(runInContext('scenario.notes', f.context), 'FIRST source');
});

test('entire assessment Excel snapshot includes notes and 32 metrics with literal text cells', () => {
  const f = fixture();
  runInContext(
    "scenario.title='Excel test';scenario.notes='=SUM(1,2) <literal>';scenario.metricNotes={AV:'Network evidence ✓'};exportExcel()",
    f.context,
  );
  assert.ok(f.downloaded);
  const text = new TextDecoder().decode(f.downloaded);
  assert.match(text, /\[Content_Types\]\.xml/);
  assert.match(text, /Network evidence ✓/);
  assert.match(text, /&lt;literal&gt;/);
  assert.match(text, /t="inlineStr"/);
  assert.doesNotMatch(text, /<f>/);
  assert.match(text, /<v>7\.6<\/v>/);
});
