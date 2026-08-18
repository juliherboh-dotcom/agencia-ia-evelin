const headers={apikey:$env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`};
const rows=await this.helpers.httpRequest({method:'GET',url:`${$env.SUPABASE_URL}/rest/v1/style_profiles?status=eq.pending&select=*&order=created_at.asc&limit=25`,headers,json:true});
return rows.map(row=>({json:row}));
