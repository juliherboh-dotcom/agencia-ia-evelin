const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "3-4. Disparar render en render service y actualizar estado"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Llama a POST /render (patr?n async: renderService responde de inmediato
 * con un `outcome`, ver comentario en renderService.ts). Este nodo nunca
 * espera a que termine el render -- el resultado real llega despu?s por
 * el webhook "Recibir resultado de render".
 *
 * Campos de 0. Config: RENDER_SERVICE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
const RENDER_SERVICE_URL = cfg.RENDER_SERVICE_URL;
const SUPABASE_URL = cfg.SUPABASE_URL;
const SUPABASE_HEADERS = {
  apikey: cfg.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${cfg.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const MAX_ATTEMPTS = 3;
const currentAttempts = $json.raw_video.render_attempts || 0;

const updateRawVideo = async (fields) => {
  await this.helpers.httpRequest({
    method: 'PATCH',
    url: `${SUPABASE_URL}/rest/v1/raw_videos?id=eq.${$json.raw_video.id}`,
    headers: SUPABASE_HEADERS,
    body: fields,
    json: true,
  });
};

let response;
try {
  response = await this.helpers.httpRequest({
    method: 'POST',
    url: `${RENDER_SERVICE_URL}/render`,
    body: { edit_spec_id: $json.edit_spec_id },
    json: true,
  });
} catch (err) {
  // render service ca?do / no accesible por red -- reintento acotado.
  const nextAttempts = currentAttempts + 1;
  await updateRawVideo({
    render_attempts: nextAttempts,
    status: nextAttempts >= MAX_ATTEMPTS ? 'failed_render_dispatch' : 'edit_spec_ready',
  });
  return [{ json: { ...$json, dispatch_ok: false, outcome: 'render_service_unreachable', error: String(err) } }];
}

if (response.outcome === 'queued' || response.outcome === 'already_in_progress') {
  await updateRawVideo({ status: 'rendering', render_attempts: 0 });
  return [{ json: { ...$json, dispatch_ok: true, outcome: response.outcome, render_id: response.render_id } }];
}

if (response.outcome === 'already_done') {
  // Idempotencia real: si ya estaba renderizado, saltamos directo al
  // estado final sin pasar por 'rendering' ni esperar ning?n webhook.
  await updateRawVideo({ status: 'rendered_pending_review' });
  return [{
    json: {
      ...$json,
      dispatch_ok: true,
      outcome: 'already_done',
      render_id: response.render_id,
      public_url: response.public_url,
    },
  }];
}

if (response.outcome === 'invalid_edit_spec') {
  // No tiene sentido reintentar solo -- hace falta que Capa 3 regenere el edit_spec.
  await updateRawVideo({ status: 'failed_render_validation', render_attempts: currentAttempts + 1 });
  return [{ json: { ...$json, dispatch_ok: false, outcome: 'invalid_edit_spec', errors: response.errors } }];
}

// not_found, internal_error, missing_input: casos inesperados -- se tratan
// igual que un fallo transitorio, con reintento acotado.
const nextAttempts = currentAttempts + 1;
await updateRawVideo({
  render_attempts: nextAttempts,
  status: nextAttempts >= MAX_ATTEMPTS ? 'failed_render_dispatch' : 'edit_spec_ready',
});
return [{ json: { ...$json, dispatch_ok: false, outcome: response.outcome, error: response.message } }];
