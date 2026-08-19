const cfg = $('0. Config').first().json;
const h={apikey:cfg.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`};
const rows=await this.helpers.httpRequest({method:'GET',url:`${cfg.SUPABASE_URL}/rest/v1/edit_specs?status=eq.ready&validation_status=eq.valid&cut_qa_status=eq.pending&select=id,raw_video_id,client_id,spec_json,created_at&order=created_at.asc&limit=25`,headers:h,json:true}); return rows.map(row=>({json:row}));
