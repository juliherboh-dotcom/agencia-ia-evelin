const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "Repair loop: construir prompt de reparaci?n"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Solo se ejecuta en la rama "inv?lido + quedan intentos" del segundo IF.
 * Su output vuelve a conectarse al nodo "4. Llamar LLM (Edit Director)",
 * cerrando el ciclo del repair loop.
 *
 * Campos de 0. Config: EDIT_SPEC_API_URL
 */
const EDIT_SPEC_API_URL = cfg.EDIT_SPEC_API_URL;

const repairPrompt = await this.helpers.httpRequest({
  method: 'POST',
  url: `${EDIT_SPEC_API_URL}/repair-prompt`,
  body: {
    edit_spec: $json.edit_spec_candidate,
    errors: $json.validation.errors,
  },
  json: true,
});

return [{
  json: {
    ...$json,
    attempt: $json.attempt + 1,
    system_prompt: repairPrompt.system,
    user_prompt: repairPrompt.user,
  },
}];
