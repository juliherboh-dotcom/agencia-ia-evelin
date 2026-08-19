const cfg = $('0. Config').first().json;
/**
 * Nodo n8n: "4. Llamar LLM (Edit Director)"
 * Tipo: Code (JavaScript, "Run Once for Each Item")
 *
 * Se reutiliza para el primer intento Y para cada reintento de reparaci?n
 * (el nodo "Repair loop" reescribe system_prompt/user_prompt y vuelve a
 * conectar ac?). No sabe ni le importa si es intento 1 o 3 -- solo llama
 * al LLM con lo que tenga en el item.
 *
 * Campos de 0. Config: ANTHROPIC_API_KEY, ANTHROPIC_VERSION, EDIT_DIRECTOR_MODEL
 */
const ANTHROPIC_API_KEY = cfg.ANTHROPIC_API_KEY;
const ANTHROPIC_VERSION = cfg.ANTHROPIC_VERSION || '2023-06-01';
const MODEL = cfg.EDIT_DIRECTOR_MODEL;

const response = await this.helpers.httpRequest({
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  headers: {
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  },
  body: {
    model: MODEL,
    max_tokens: 4096,
    // M?s determin?stico en los reintentos de reparaci?n que en el
    // primer intento (menos margen creativo cuando ya sabemos qu? fall?).
    temperature: $json.attempt > 1 ? 0.2 : 0.4,
    system: $json.system_prompt,
    messages: [{ role: 'user', content: $json.user_prompt }],
  },
  json: true,
});

const rawText = (response.content || []).map((block) => block.text || '').join('');
const cleaned = rawText
  .trim()
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```\s*$/i, '');

let editSpecCandidate = null;
let parseOk = true;
let parseErrorMessage = null;

try {
  editSpecCandidate = JSON.parse(cleaned);
} catch (err) {
  parseOk = false;
  parseErrorMessage = err.message;
}

return [{
  json: {
    ...$json,
    llm_raw_text: rawText,
    parse_ok: parseOk,
    edit_spec_candidate: editSpecCandidate,
    parse_error_message: parseErrorMessage,
  },
}];
