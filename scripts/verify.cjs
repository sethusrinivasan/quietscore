const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');const root=path.resolve(__dirname,'..');
(async()=>{
 const c={};for(const file of ['cvss_lookup.js','max_composed.js','max_severity.js','cvss_score.js'])vm.runInNewContext(fs.readFileSync(path.join(root,'reference',file),'utf8'),c);
 const e=(await WebAssembly.instantiate(fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/quietscore.wasm')),{})).instance.exports;
 const enc=new TextEncoder(),dec=new TextDecoder();function run(a,s=''){const b=enc.encode(s);new Uint8Array(e.memory.buffer,e.input_ptr(),b.length).set(b);const n=e.run(a,b.length);return dec.decode(new Uint8Array(e.memory.buffer,e.output_ptr(),n));}
 const metrics=JSON.parse(fs.readFileSync(path.join(root,'metrics.json')));const base=metrics.filter(m=>m.group===0);const defaults=Object.fromEntries(metrics.map(m=>[m.key,m.group===0?m.options[0].value:'X']));
 let tested=0;const mismatches=[];
 function check(values){const v='CVSS:4.0'+metrics.filter(m=>m.group===0||values[m.key]!=='X').map(m=>`/${m.key}:${values[m.key]}`).join('');const expected=c.cvss_score(values,c.cvssLookup_global,c.maxSeverity,c.macroVector(values));const actual=Number(run(9,v));tested++;if(expected!==actual&&mismatches.length<10)mismatches.push({v,expected,actual});}
 function exhaustive(i,values){if(i===base.length){check(values);return}for(const o of base[i].options){values[base[i].key]=o.value;exhaustive(i+1,values)}}
 exhaustive(0,{...defaults});
 let seed=472029;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};
 for(let i=0;i<12000;i++){const values={};for(const m of metrics)values[m.key]=m.options[next()%m.options.length].value;check(values)}
 assert.deepEqual(mismatches,[],JSON.stringify(mismatches));
 const sample='CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N';run(1,sample);const report=JSON.parse(run(5));assert.equal(report.vector,sample);
 run(1,report.vector);assert.equal(JSON.parse(run(5)).score,report.score);
 const text=run(6);const recovered=text.split('\n').find(s=>s.startsWith('CVSS:'));assert.equal(recovered,sample);
 const before=run(8);for(const invalid of [sample+'/AV:N',sample+'/BOGUS:N',sample.replace('/AT:P',''),sample.replace('UI:P','UI:H'),'CVSS:3.1/AV:N',sample+'/',sample+'/MSI:invalid',sample+'/<script>:X']){assert.match(run(1,invalid),/class="error"/);assert.equal(run(8),before);assert.match(run(9,invalid),/^ERROR:/)}
 for(let i=0;i<4;i++){const html=run(3,String(i));assert.match(html,/role="tabpanel"/);assert.ok(!html.includes('NaN'));}
 console.log(JSON.stringify({passed:true,comparedVectors:tested,exhaustiveBase:104976,optionalCombinations:12000,example:report,exportImport:'JSON and text roundtrips pass',validation:'8 invalid vectors rejected; prior valid state preserved',tabs:'all four rendered'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
