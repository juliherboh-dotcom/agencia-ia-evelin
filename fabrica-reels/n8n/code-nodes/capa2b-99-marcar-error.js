const source=$json.profile||$json; const id=source.id||source.style_profile_id;
if(id)await this.helpers.httpRequest({method:'PATCH',url:`${$env.SUPABASE_URL}/rest/v1/style_profiles?id=eq.${id}`,headers:{apikey:$env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:{status:'failed',processing_error:String($json.error?.message||$json.message||'Error de procesamiento').slice(0,2000)},json:true});
return [{json:{style_profile_id:id,status:'failed'}}];
