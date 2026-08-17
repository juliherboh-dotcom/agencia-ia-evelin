/**
 * Nodo n8n: "4. Persistir variantes y finalizar"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN,
 *      TELEGRAM_CHAT_ID
 */
const SUPABASE_URL = $env.SUPABASE_URL;
const headers = {
  apikey: $env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${$env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const raw = $json.raw_video;
const variants = $json.variant_batch.variants;
const typeB = variants.filter((v) => v.variant_type === 'B');
const typeA = variants.filter((v) => v.variant_type === 'A');

// generation_key + upsert hace recuperable un fallo parcial: una reejecucion
// no duplica las filas que alcanzaron a guardarse.
for (let i = 0; i < typeB.length; i += 1) {
  const variant = typeB[i];
  const generationKey = `${raw.id}:capa9:B:${i}`;
  const version = $json.next_edit_spec_version + i;
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/edit_specs?on_conflict=generation_key`,
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      raw_video_id: raw.id,
      parent_edit_spec_id: $json.parent_edit_spec_id,
      template_id: variant.edit_spec.template_id,
      spec_json: variant.edit_spec,
      schema_version: variant.edit_spec.schema_version,
      version,
      status: 'ready',
      validation_status: 'valid',
      validation_errors: null,
      repair_attempts: variant.repair_attempts || 0,
      variant_type_origen: variant.variant_type_origen || 're_corte_automatico',
      generation_key: generationKey,
    },
    json: true,
  });
}

for (let i = 0; i < typeA.length; i += 1) {
  const variant = typeA[i];
  const generationKey = `${raw.id}:capa9:A:${i}`;
  await this.helpers.httpRequest({
    method: 'POST',
    url: `${SUPABASE_URL}/rest/v1/scripts?on_conflict=generation_key`,
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: {
      client_id: raw.client_id,
      parent_video_id: raw.id,
      variant_type: 'A_requiere_grabacion',
      variant_type_origen: variant.variant_type_origen || 'nuevo_guion',
      idea: variant.idea,
      hook: variant.hook,
      guion: variant.guion,
      angulo: variant.angulo,
      status: 'pendiente_grabacion',
      generation_key: generationKey,
    },
    json: true,
  });
}

await this.helpers.httpRequest({
  method: 'PATCH',
  url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${raw.id}&variant_generation_status=eq.in_progress`,
  headers,
  body: {
    variant_generation_status: 'variants_generated',
    variant_generation_completed_at: new Date().toISOString(),
    variant_generation_error: null,
  },
  json: true,
});

let chatId = $env.TELEGRAM_CHAT_ID;
const clients = await this.helpers.httpRequest({
  method: 'GET',
  url: `${SUPABASE_URL}/rest/v1/clients?id=eq.${raw.client_id}&select=telegram_chat_id`,
  headers,
  json: true,
});
if (clients[0]?.telegram_chat_id) chatId = clients[0].telegram_chat_id;
let telegramAlert = 'sent';
try {
  await this.helpers.httpRequest({
    method: 'POST',
    url: `https://api.telegram.org/bot${$env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    body: {
      chat_id: chatId,
      text: `Variantes generadas para ${raw.filename || raw.id}: ${typeB.length} Tipo B listas para render y ${typeA.length} Tipo A pendientes de grabacion.`,
    },
    json: true,
  });
} catch (err) {
  // La alerta no revierte un lote ya persistido. El resultado lo deja visible.
  telegramAlert = `failed: ${err.message}`;
}

return [{ json: {
  raw_video_id: raw.id,
  outcome: 'variants_generated',
  type_a_count: typeA.length,
  type_b_count: typeB.length,
  telegram_alert: telegramAlert,
} }];
