const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "2. Llamar Variant Director"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 * Config: ANTHROPIC_API_KEY, ANTHROPIC_VERSION, VARIANT_DIRECTOR_MODEL
 */
const response = await this.helpers.httpRequest({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'x-api-key': cfg.ANTHROPIC_API_KEY,
    'anthropic-version': cfg.ANTHROPIC_VERSION || '2023-06-01',
    'content-type': 'application/json',
  },
  body: {
    model: cfg.VARIANT_DIRECTOR_MODEL || cfg.EDIT_DIRECTOR_MODEL,
    max_tokens: 12000,
    temperature: 0.4,
    system: $json.system_prompt,
    messages: [{ role: 'user', content: $json.user_prompt }],
  },
  json: true,
});

const rawText = (response.content || []).map((b) => b.text || '').join('');
const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
let candidate;
try { candidate = JSON.parse(cleaned); } catch (err) {
  throw new Error(`Variant Director no devolvio JSON valido: ${err.message}`);
}
const variants = candidate?.variants;
if (!Array.isArray(variants)) throw new Error('Variant Director no devolvio variants[].');
const bCount = variants.filter((v) => v.variant_type === 'B').length;
const aCount = variants.filter((v) => v.variant_type === 'A').length;
const wrongOrder = variants.some((v, i) => v.variant_type === 'B' && variants.slice(0, i).some((x) => x.variant_type === 'A'));
if (bCount < 2 || bCount > 3 || aCount < 5 || aCount > 7 || wrongOrder) {
  throw new Error(`Lote invalido: se esperaban 2-3 Tipo B primero y 5-7 Tipo A; llegaron B=${bCount}, A=${aCount}, orden_invalido=${wrongOrder}.`);
}
for (const [i, variant] of variants.entries()) {
  if (!variant.idea || !variant.angulo || !variant.winner_mechanism) throw new Error(`Variante ${i} incompleta.`);
  if (variant.variant_type === 'A' && (!variant.hook || !variant.guion)) throw new Error(`Variante Tipo A ${i} no tiene hook/guion.`);
  if (variant.variant_type === 'B' && !variant.edit_spec) throw new Error(`Variante Tipo B ${i} no tiene edit_spec completo.`);
}

return [{ json: { ...$json, llm_raw_text: rawText, variant_batch: candidate } }];
