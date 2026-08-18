const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const codeDir = path.join(__dirname, '..', 'code-nodes');

async function runNode(filename, { json = {}, env = {}, httpRequest }) {
  const source = fs.readFileSync(path.join(codeDir, filename), 'utf8');
  const fn = new Function('$json', '$env', `return (async function () {\n${source}\n}).call(this);`);
  return fn.call({ helpers: { httpRequest } }, json, env);
}
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'role',EDIT_SPEC_API_URL:'http://api',ANTHROPIC_API_KEY:'key',EDIT_DIRECTOR_MODEL:'model',TELEGRAM_BOT_TOKEN:'bot',TELEGRAM_CHAT_ID:'chat'};

test('Capa 2B detecta solo perfiles pending',async()=>{const out=await runNode('capa2b-00-detectar-perfiles-pendientes.js',{env,httpRequest:async r=>{assert.match(r.url,/status=eq\.pending/);return[{id:'p1'}]}});assert.deepEqual(out,[{json:{id:'p1'}}])});

test('Capa 2B analiza cinco frames por video y consolida sin inventar audio',async()=>{let anthropic=0;const profile={id:'p1',source_video_refs:['https://cdn/a.mp4','https://cdn/b.mp4']};const valid={fonts:[],color_palette:[],cut_pacing:{},card_patterns:{},audio_notes:{status:'no_verificable_sin_audio',music:null,sfx:null},exceptions:[]};const out=await runNode('capa2b-01-analizar-y-consolidar.js',{json:profile,env,httpRequest:async r=>{if(r.method==='PATCH')return[profile];if(r.url.endsWith('/prompts/style-profile-system'))return{text:'prompt'};if(r.url.endsWith('/video-frames')){assert.deepEqual(r.body.positions,[.1,.3,.5,.7,.9]);return{frames:Array(5).fill({media_type:'image/jpeg',data:'AA=='})}};if(r.url.includes('anthropic.com')){anthropic++;return{content:[{text:JSON.stringify(valid)}]}};throw Error(r.url)}});assert.equal(anthropic,3);assert.equal(out[0].json.analyses.length,2);assert.equal(out[0].json.result.audio_notes.status,'no_verificable_sin_audio')});

test('Capa 2B persiste perfil activo y archiva el anterior',async()=>{const requests=[];await runNode('capa2b-02-persistir-perfil.js',{json:{profile:{id:'p2',client_id:'c1'},analyses:[],result:{fonts:[],color_palette:[],cut_pacing:{},card_patterns:{},audio_notes:{status:'no_verificable_sin_audio'}}},env,httpRequest:async r=>{requests.push(r);return[]}});assert.equal(requests.length,2);assert.equal(requests[1].body.status,'active')});

test('Capa 3.5 extrae cuatro frames repartidos por cada corte keep',async()=>{const spec={id:'s1',spec_json:{source_video:{url:'https://cdn/v.mp4'},cuts:[{start:2,end:5,keep:true},{start:5,end:7,keep:false}]}};const out=await runNode('capa3-5-01-extraer-y-evaluar.js',{json:spec,env,httpRequest:async r=>{if(r.method==='PATCH')return[spec];if(r.url.endsWith('/prompts/cut-qa-system'))return{text:'qa'};if(r.url.endsWith('/video-frames')){assert.equal(r.body.timestamps.length,4);return{frames:r.body.timestamps.map(timestamp=>({timestamp,media_type:'image/jpeg',data:'AA=='}))}};return{content:[{text:JSON.stringify({results:[{cut_index:0,ok:true,flagged_frame_time:null,reason:null}]})}]}}});assert.equal(out[0].json.cuts.length,1)});

test('Capa 3.5 passed habilita Capa 4 sin alerta',async()=>{const requests=[];const out=await runNode('capa3-5-02-persistir-y-alertar.js',{json:{spec:{id:'s1',raw_video_id:'r1',client_id:'c1'},cuts:[],results:[{cut_index:0,ok:true,flagged_frame_time:null,reason:null}]},env,httpRequest:async r=>{requests.push(r);return[]}});assert.equal(out[0].json.cut_qa_status,'passed');assert.equal(requests.some(r=>r.url.includes('telegram.org')),false);assert.equal(requests.find(r=>r.url.includes('/edit_specs?')).body.cut_qa_status,'passed')});

test('Capa 3.5 flagged guarda auditoria y envia foto + botones',async()=>{const requests=[];const cut={cut_index:0,frames:[{timestamp:1,media_type:'image/jpeg',data:'AA=='}]};const out=await runNode('capa3-5-02-persistir-y-alertar.js',{json:{spec:{id:'s1',raw_video_id:'r1',client_id:'c1'},cuts:[cut],results:[{cut_index:0,ok:false,flagged_frame_time:1,reason:'mirada abajo'}]},env,httpRequest:async r=>{requests.push(r);if(r.url.includes('/clients?'))return[{telegram_chat_id:'client-chat'}];return[]}});assert.equal(out[0].json.cut_qa_status,'flagged');assert.ok(requests.some(r=>r.url.endsWith('/sendPhoto')&&r.formData.photo));const message=requests.find(r=>r.url.endsWith('/sendMessage'));assert.match(message.body.reply_markup.inline_keyboard[0][1].callback_data,/^cqrg:/)});

test('workflows embeben exactamente los code-nodes',()=>{for(const workflowName of ['capa2b-style-profile.workflow.json','capa3-5-cut-qa.workflow.json']){const workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'..',workflowName),'utf8'));for(const node of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.code')){assert.ok(!node.parameters.jsCode.startsWith('SYNC:'));assert.ok(node.sourceFile);assert.equal(node.parameters.jsCode,fs.readFileSync(path.join(codeDir,node.sourceFile),'utf8'))}}});
