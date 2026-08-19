const cfg = $('0. Config').first().json;
const headers={apikey:cfg.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`};
const rows=await this.helpers.httpRequest({method:'GET',url:`${cfg.SUPABASE_URL}/rest/v1/style_profiles?status=eq.pending&select=*&order=created_at.asc&limit=25`,headers,json:true});
return rows.map(row=>({json:row}));
