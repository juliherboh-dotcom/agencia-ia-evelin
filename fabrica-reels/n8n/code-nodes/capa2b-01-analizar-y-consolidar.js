const cfg = $('0. Config').first().json;
const profile=$json; const sbHeaders={apikey:cfg.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'};
const claimed=await this.helpers.httpRequest({method:'PATCH',url:`${cfg.SUPABASE_URL}/rest/v1/style_profiles?id=eq.${profile.id}&status=eq.pending`,headers:sbHeaders,body:{status:'in_progress'},json:true});
if(!claimed.length)return [];
const prompt=await this.helpers.httpRequest({method:'GET',url:`${cfg.EDIT_SPEC_API_URL}/prompts/style-profile-system`,json:true});
const analyses=[];
for(const url of profile.source_video_refs){
 const extracted=await this.helpers.httpRequest({method:'POST',url:`${cfg.EDIT_SPEC_API_URL}/video-frames`,body:{video_url:url,positions:[0.1,0.3,0.5,0.7,0.9]},json:true});
 const content=[{type:'text',text:`Analiza esta referencia: ${url}. Metadata/transcript no disponibles; no inventes audio.`},...extracted.frames.map(f=>({type:'image',source:{type:'base64',media_type:f.media_type,data:f.data}}))];
 const response=await this.helpers.httpRequest({method:'POST',url:'https://api.anthropic.com/v1/messages',headers:{'x-api-key':cfg.ANTHROPIC_API_KEY,'anthropic-version':cfg.ANTHROPIC_VERSION||'2023-06-01','content-type':'application/json'},body:{model:cfg.EDIT_DIRECTOR_MODEL,max_tokens:3000,temperature:0.2,system:prompt.text,messages:[{role:'user',content}]},json:true});
 const text=(response.content||[]).map(b=>b.text||'').join('').trim().replace(/^```json\s*|```$/gi,''); const analysis=JSON.parse(text); for(const key of ['fonts','color_palette','cut_pacing','card_patterns','audio_notes'])if(analysis[key]===undefined)throw new Error(`Analisis individual sin ${key}`); analyses.push({source:url,analysis});
}
const consolidatedResponse=await this.helpers.httpRequest({method:'POST',url:'https://api.anthropic.com/v1/messages',headers:{'x-api-key':cfg.ANTHROPIC_API_KEY,'anthropic-version':cfg.ANTHROPIC_VERSION||'2023-06-01','content-type':'application/json'},body:{model:cfg.EDIT_DIRECTOR_MODEL,max_tokens:3000,temperature:0.1,system:prompt.text,messages:[{role:'user',content:`Consolida estos analisis y documenta excepciones: ${JSON.stringify(analyses)}`}]},json:true});
const raw=(consolidatedResponse.content||[]).map(b=>b.text||'').join('').trim().replace(/^```json\s*|```$/gi,''); const result=JSON.parse(raw);
for(const key of ['fonts','color_palette','cut_pacing','card_patterns','audio_notes'])if(result[key]===undefined)throw new Error(`Perfil consolidado sin ${key}`);
if(!result.audio_notes||result.audio_notes.status!=='no_verificable_sin_audio')throw new Error('audio_notes debe declarar no_verificable_sin_audio');
return [{json:{profile,analyses,result}}];
