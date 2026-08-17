/**
 * Nodo n8n: "3. Validar y reparar Tipo B"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Maximo 3 intentos totales por edit_spec (inicial + 2 reparaciones).
 * Env: EDIT_SPEC_API_URL, ANTHROPIC_API_KEY, ANTHROPIC_VERSION,
 *      VARIANT_DIRECTOR_MODEL o EDIT_DIRECTOR_MODEL
 */
const API = $env.EDIT_SPEC_API_URL;
const variants = $json.variant_batch.variants;
const repairAudit = [];

async function parseLlm(response) {
  const text = (response.content || []).map((b) => b.text || '').join('').trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
  try { return { value: JSON.parse(text), parseError: null }; }
  catch (err) { return { value: null, parseError: err.message }; }
}

for (let index = 0; index < variants.length; index += 1) {
  const variant = variants[index];
  if (variant.variant_type !== 'B') continue;
  let candidate = variant.edit_spec;
  let validation = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    validation = candidate
      ? await this.helpers.httpRequest({ method: 'POST', url: `${API}/validate`, body: { edit_spec: candidate }, json: true })
      : { valid: false, errors: [{ path: '(root)', message: 'La reparacion no devolvio JSON valido.' }] };
    repairAudit.push({ variant_index: index, attempt, valid: validation.valid, errors: validation.errors || [] });
    if (validation.valid) {
      variant.edit_spec = validation.data;
      variant.repair_attempts = attempt - 1;
      break;
    }
    if (attempt === 3) {
      throw new Error(`Tipo B ${index} invalida tras 3 intentos: ${JSON.stringify(validation.errors)}`);
    }
    const repair = await this.helpers.httpRequest({
      method: 'POST', url: `${API}/repair-prompt`,
      body: { edit_spec: candidate, errors: validation.errors }, json: true,
    });
    const llm = await this.helpers.httpRequest({
      method: 'POST', url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': $env.ANTHROPIC_API_KEY,
        'anthropic-version': $env.ANTHROPIC_VERSION || '2023-06-01',
        'content-type': 'application/json',
      },
      body: {
        model: $env.VARIANT_DIRECTOR_MODEL || $env.EDIT_DIRECTOR_MODEL,
        max_tokens: 6000, temperature: 0.2, system: repair.system,
        messages: [{ role: 'user', content: repair.user }],
      },
      json: true,
    });
    const parsed = await parseLlm(llm);
    candidate = parsed.value;
    if (parsed.parseError) validation = { valid: false, errors: [{ path: '(root)', message: parsed.parseError }] };
  }
}

return [{ json: { ...$json, variant_batch: { ...$json.variant_batch, variants }, repair_audit: repairAudit } }];
