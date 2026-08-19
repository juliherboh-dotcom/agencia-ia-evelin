const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "5-6. Validar edit_spec"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Si el LLM devolvi? algo que ni siquiera parsea como JSON, no llama al
 * servicio de validaci?n -- arma directamente el mismo shape de error que
 * devolver?a, para que el resto del flujo no tenga que distinguir "no
 * parse?" de "parse? pero es inv?lido".
 *
 * Campos de 0. Config: EDIT_SPEC_API_URL
 */
const EDIT_SPEC_API_URL = cfg.EDIT_SPEC_API_URL;

let validation;

if (!$json.parse_ok) {
  validation = {
    valid: false,
    errors: [{
      path: '(root)',
      message: `La respuesta del LLM no es JSON v?lido: ${$json.parse_error_message}`,
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
