const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const codeDir = path.join(__dirname, '..', 'code-nodes');

async function runNode(filename, { json = {}, env = {}, httpRequest }) {
  const source = fs.readFileSync(path.join(codeDir, filename), 'utf8');
  const fn = new Function('$json', '$', `return (async function () {\n${source}\n}).call(this);`);
  const $ = () => ({ first: () => ({ json: env }) });
  return fn.call({ helpers: { httpRequest } }, json, $);
}

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  EDIT_SPEC_API_URL: 'http://edit-spec-api:3002',
  ANTHROPIC_API_KEY: 'test-key',
  EDIT_DIRECTOR_MODEL: 'test-model',
  TELEGRAM_BOT_TOKEN: 'test-bot',
  TELEGRAM_CHAT_ID: '123',
};

const aVariant = (i) => ({
  variant_type: 'A', variant_type_origen: 'nuevo_guion', idea: `Idea A${i}`,
  hook: `Hook A${i}`, guion: `Guion completo A${i}`, angulo: `Angulo A${i}`,
  winner_mechanism: 'Utilidad compartible',
});
const bVariant = (i) => ({
  variant_type: 'B', variant_type_origen: 'nuevo_hook', idea: `Idea B${i}`,
  angulo: `Angulo B${i}`, winner_mechanism: 'Hook y retencion',
  edit_spec: { schema_version: '1.0.0', template_id: 'personal_brand_clean' },
});
test('detector convierte la cola ready en items n8n', async () => {
  const result = await runNode('capa9-00-detectar-videos-ready.js', {
    env,
    httpRequest: async (request) => {
      assert.match(request.url, /variant_generation_status=eq\.ready/);
      return [{ id: 'winner-1' }, { id: 'winner-2' }];
    },
  });
  assert.deepEqual(result, [{ json: { id: 'winner-1' } }, { json: { id: 'winner-2' } }]);
});

test('Variant Director acepta 2 Tipo B primero y 5 Tipo A', async () => {
  const batch = { winner_analysis: 'Shares altos', variants: [bVariant(1), bVariant(2), ...Array.from({ length: 5 }, (_, i) => aVariant(i + 1))] };
  const result = await runNode('capa9-02-llamar-variant-director.js', {
    json: { system_prompt: 'system', user_prompt: 'user' }, env,
    httpRequest: async () => ({ content: [{ text: JSON.stringify(batch) }] }),
  });
  assert.equal(result[0].json.variant_batch.variants.length, 7);
  assert.equal(result[0].json.variant_batch.variants[0].variant_type, 'B');
  assert.equal(result[0].json.variant_batch.variants[2].variant_type, 'A');
});

test('Variant Director rechaza cantidades fuera del contrato', async () => {
  const batch = { winner_analysis: 'x', variants: [bVariant(1), ...Array.from({ length: 5 }, (_, i) => aVariant(i + 1))] };
  await assert.rejects(() => runNode('capa9-02-llamar-variant-director.js', {
    json: { system_prompt: 'system', user_prompt: 'user' }, env,
    httpRequest: async () => ({ content: [{ text: JSON.stringify(batch) }] }),
  }), /se esperaban 2-3 Tipo B/);
});

test('Tipo B se repara y vuelve a validar dentro de 3 intentos', async () => {
  const variants = [bVariant(1), bVariant(2), ...Array.from({ length: 5 }, (_, i) => aVariant(i + 1))];
  let validateCalls = 0;
  const result = await runNode('capa9-03-validar-y-reparar-tipo-b.js', {
    json: { variant_batch: { variants } }, env,
    httpRequest: async (request) => {
      if (request.url.endsWith('/validate')) {
        validateCalls += 1;
        if (validateCalls === 1) return { valid: false, errors: [{ path: 'cuts', message: 'invalido' }] };
        return { valid: true, data: { ...request.body.edit_spec, validated: true } };
      }
      if (request.url.endsWith('/repair-prompt')) return { system: 'repair', user: 'fix' };
      if (request.url.includes('anthropic.com')) return { content: [{ text: JSON.stringify({ schema_version: '1.0.0', template_id: 'personal_brand_clean' }) }] };
      throw new Error(`Request inesperado: ${request.url}`);
    },
  });
  assert.equal(result[0].json.variant_batch.variants[0].repair_attempts, 1);
  assert.equal(result[0].json.variant_batch.variants[1].repair_attempts, 0);
  assert.equal(result[0].json.repair_audit.length, 3);
});

test('persistencia crea 2 edit_specs, 5 scripts y finaliza la cola', async () => {
  const variants = [bVariant(1), bVariant(2), ...Array.from({ length: 5 }, (_, i) => aVariant(i + 1))];
  const requests = [];
  const result = await runNode('capa9-04-persistir-y-finalizar.js', {
    json: {
      raw_video: { id: 'raw-1', client_id: 'client-1', filename: 'ganador.mp4' },
      parent_edit_spec_id: 'spec-1', next_edit_spec_version: 4,
      variant_batch: { variants },
    }, env,
    httpRequest: async (request) => {
      requests.push(request);
      if (request.url.includes('/clients?')) return [{ telegram_chat_id: '456' }];
      return [{}];
    },
  });
  assert.equal(requests.filter((r) => r.url.includes('/edit_specs?')).length, 2);
  assert.equal(requests.filter((r) => r.url.includes('/scripts?')).length, 5);
  const finalPatch = requests.find((r) => r.method === 'PATCH');
  assert.equal(finalPatch.body.variant_generation_status, 'variants_generated');
  assert.deepEqual(result[0].json, {
    raw_video_id: 'raw-1', outcome: 'variants_generated', type_a_count: 5,
    type_b_count: 2, telegram_alert: 'sent',
  });
});
