const cfg = $('0. Config').first().json;
const source=$json.spec||$json; const id=source.id||source.edit_spec_id;
if(id)await this.helpers.httpRequest({method:'PATCH',url:`${cfg.SUPABASE_URL}/rest/v1/edit_specs?id=eq.${id}&cut_qa_status=eq.in_progress`,headers:{apikey:cfg.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},body:{cut_qa_status:'pending'},json:true});
return [{json:{edit_spec_id:id,status:'retry_pending',error:String($json.error?.message||$json.message||'Error de QA')}}];
