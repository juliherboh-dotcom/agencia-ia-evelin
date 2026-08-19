const cfg = $('0. Config').first().json;
const h={apikey:cfg.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'}; const {profile,result,analyses}=$json;
await this.helpers.httpRequest({method:'PATCH',url:`${cfg.SUPABASE_URL}/rest/v1/style_profiles?client_id=eq.${profile.client_id}&status=eq.active&id=neq.${profile.id}`,headers:h,body:{status:'archived'},json:true});
await this.helpers.httpRequest({method:'PATCH',url:`${cfg.SUPABASE_URL}/rest/v1/style_profiles?id=eq.${profile.id}&status=eq.in_progress`,headers:h,body:{fonts:result.fonts,color_palette:result.color_palette,cut_pacing:result.cut_pacing,card_patterns:{...result.card_patterns,exceptions:result.exceptions||[],individual_analyses:analyses},audio_notes:result.audio_notes,status:'active'},json:true});
return [{json:{style_profile_id:profile.id,status:'active'}}];
