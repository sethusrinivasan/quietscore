const fs = require('fs'),
  vm = require('vm'),
  path = require('path');
const root = path.resolve(__dirname, '..'),
  c = {};
for (const file of ['cvss_lookup.js', 'max_composed.js'])
  vm.runInNewContext(fs.readFileSync(path.join(root, 'reference', file), 'utf8'), c);
let s = '// Derived from FIRST, Red Hat, and contributors. BSD-2-Clause. See FIRST-LICENSE.\n';
s += 'pub fn lookup(e:[u8;6])->f64 { match e {\n';
for (const [k, v] of Object.entries(c.cvssLookup_global))
  s += `[${k.split('').join(',')}] => ${Number(v).toFixed(1)},\n`;
s += '_ => f64::NAN } }\n';
s +=
  "pub fn maxes(eq:usize, value:u8, eq6:u8)-> &'static [&'static str] { match (eq,value,eq6) {\n";
for (let eq = 1; eq <= 5; eq++)
  for (const [v, items] of Object.entries(c.maxComposed['eq' + eq])) {
    if (eq === 3)
      for (const [six, arr] of Object.entries(items))
        s += `(${eq},${v},${six})=>&${JSON.stringify(arr)},\n`;
    else s += `(${eq},${v},_)=>&${JSON.stringify(items)},\n`;
  }
s += '_ => &[] } }\n';
fs.writeFileSync(path.join(root, 'src/tables.rs'), s);
