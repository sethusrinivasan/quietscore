// Browser-only DOM, clipboard and file bridge. State, validation, scoring and HTML rendering live in Rust/WASM.
const enc=new TextEncoder(),dec=new TextDecoder();let engine;
const root=document.getElementById('app');
function call(action=0,input=''){
 const data=enc.encode(input);if(data.length>16384)throw Error('Input exceeds the 16 KB bridge limit.');
 new Uint8Array(engine.memory.buffer,engine.input_ptr(),data.length).set(data);
 const len=engine.run(action,data.length);if(!len)throw Error('The calculator could not process this input.');
 return dec.decode(new Uint8Array(engine.memory.buffer,engine.output_ptr(),len));
}
function paint(action=0,input='',focus){
 const open=[...root.querySelectorAll('details[open]')].map(x=>x.closest('.metric')?.querySelector('input')?.name||x.className);
 root.innerHTML=call(action,input);
 for(const d of root.querySelectorAll('details')){const key=d.closest('.metric')?.querySelector('input')?.name||d.className;if(open.includes(key))d.open=true;}
 if(focus){const el=focus.startsWith('tab-')?document.getElementById(focus):root.querySelector(`input[name="${focus}"]:checked`);el?.focus({preventScroll:true});}
}
let toastTimer;function toast(message){const t=document.getElementById('toast');t.textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.textContent='',5000);}
function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function importVector(vector){paint(1,vector);const err=root.querySelector('.error');if(err)throw Error(err.textContent);return JSON.parse(call(8));}
function extractFile(text,name){
 if(name.toLowerCase().endsWith('.json')){
  let data;try{data=JSON.parse(text)}catch{throw Error('Invalid JSON. Choose a JSON assessment exported by this calculator.');}
  if(!data||typeof data!=='object'||Array.isArray(data)||typeof data.vector!=='string')throw Error('The JSON file must contain a string named "vector".');
  if(data.format!==undefined&&(data.format!=='quiet-cvss'||data.schemaVersion!==1))throw Error('Unsupported assessment format or schema version.');
  if(data.cvssVersion!==undefined&&data.cvssVersion!=='4.0')throw Error('Only CVSS 4.0 assessments are supported.');
  return data.vector;
 }
 const candidates=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith('CVSS:'));
 if(candidates.length!==1)throw Error('The text file must contain exactly one CVSS vector on its own line.');
 return candidates[0];
}
root.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('vector-input').value;paint(1,input);});
root.addEventListener('change',async e=>{
 try{
 if(e.target.matches('input[type="radio"]'))paint(2,`${e.target.name}:${e.target.value}`,e.target.name);
 if(e.target.id==='file-input'){
  const file=e.target.files[0];if(!file)return;if(file.size>65536)throw Error('Choose a text or JSON assessment smaller than 64 KB.');
  const vector=extractFile(await file.text(),file.name);importVector(vector);toast('Assessment imported and score recalculated locally.');
 }
 }catch(error){toast(error.message);}
});
root.addEventListener('keydown',e=>{
 if(e.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){
 e.preventDefault();let tab=Number(e.target.dataset.tab);tab=e.key==='Home'?0:e.key==='End'?3:(tab+(e.key==='ArrowRight'?1:3))%4;paint(3,String(tab),`tab-${tab}`);
 }
});
root.addEventListener('click',async e=>{
 const tab=e.target.closest('[data-tab]');if(tab){paint(3,tab.dataset.tab,`tab-${tab.dataset.tab}`);return;}
 const button=e.target.closest('[data-action]');if(!button)return;
 try{switch(button.dataset.action){
 case 'file':document.getElementById('file-input').click();break;
 case 'reset':paint(4);break;
 case 'json':download(call(5),'application/json','cvss-assessment.json');toast('JSON downloaded.');break;
 case 'text':download(call(6),'text/plain;charset=utf-8','cvss-assessment.txt');toast('Text assessment downloaded.');break;
 case 'copy':{
 const vector=call(7);try{await navigator.clipboard.writeText(vector);}catch{
 const input=document.getElementById('vector-input');input.value=vector;input.focus();input.select();if(!document.execCommand('copy')){toast('Vector selected. Press Ctrl+C or Cmd+C to copy.');return;}}
 toast('Vector copied.');break;}
 }}catch(error){toast(error.message);}
});
try{
 const binary=Uint8Array.from(atob(WASM_BASE64),c=>c.charCodeAt(0));
 engine=(await WebAssembly.instantiate(binary,{})).instance.exports;paint();
 // Opt-in browser standard. Never sends anything to a server; unavailable in most browsers.
 if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
 await Promise.resolve(document.modelContext.registerTool({name:'apply_cvss_vector',title:'Apply CVSS 4.0 vector',description:'Validate a CVSS 4.0 vector locally, update the visible calculator, and return its recalculated severity.',inputSchema:{type:'object',properties:{vector:{type:'string',maxLength:8192}},required:['vector'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input.vector!=='string'||Object.keys(input).some(k=>k!=='vector'))throw Error('Provide only a vector string.');return importVector(input.vector);}},{signal:lifecycle.signal})).catch(()=>{});
 }
}catch(error){root.innerHTML='<section class="loading"><h1>The local engine could not start.</h1><p>This calculator requires a browser with WebAssembly enabled. No assessment was sent anywhere.</p></section>';}
