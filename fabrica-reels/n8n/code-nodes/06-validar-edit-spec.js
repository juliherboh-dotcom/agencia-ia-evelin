/**
 * Nodo n8n: "5-6. Validar edit_spec"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Si el LLM devolvió algo que ni siquiera parsea como JSON, no llama al
 * servicio de validación -- arma directamente el mismo shape de error que
 * devolvería, para que el resto del flujo no tenga que distinguir "no
 * parseó" de "parseó pero es inválido".
 *
 * Env vars usadas: EDIT_SPEC_API_URL
 */
const EDIT_SPEC_API_URL = $env.EDIT_SPEC_API_URL;

let validation;

if (!$json.parse_ok) {
  validation = {
    valid: false,
    errors: [{
      path: '(root)',
      message: `La respuesta del LLM no es JSON válido: ${$json.parse_error_message}`,
    }],
  };
} else {
  validation = await this.helpers.httpRequest({
    method: 'POST',
    url: `${EDIT_SPEC_API_URL}/validate`,
    body: { edit_spec: $json.edit_spec_candidate },
    json: true,
  });
}

return [{ json: { ...$json, validation } }];
