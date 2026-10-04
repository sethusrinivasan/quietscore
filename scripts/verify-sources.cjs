const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');const provenance=JSON.parse(fs.readFileSync(path.join(root,'reference/provenance.json')));
for(const [name,expected]of Object.entries(provenance.sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'reference',name))).digest('hex'),expected,`Pinned FIRST file changed: ${name}`);
const c={};vm.runInNewContext(fs.readFileSync(path.join(root,'reference/cvss_config.js'),'utf8'),c);const official={};
function walk(value){if(value&&typeof value==='object'){if(value.short&&value.options)official[value.short]=Object.values(value.options).map(o=>o.value).filter(v=>typeof v==='string').sort();for(const item of Object.values(value))walk(item)}}walk(c.cvssConfig);
const own=JSON.parse(fs.readFileSync(path.join(root,'metrics.json')));assert.equal(Object.keys(official).length,own.length);
for(const metric of own)assert.deepEqual(metric.options.map(o=>o.value).sort(),official[metric.key],`Classifications differ from FIRST: ${metric.key}`);
console.log(`FIRST provenance verified: ${provenance.commit}; all 32 metric classifications match.`);
