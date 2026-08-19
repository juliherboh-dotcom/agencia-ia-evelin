const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const n8nDir = path.join(__dirname, '..');
const codeDir = path.join(n8nDir, 'code-nodes');
const expected = {"capa2b-style-profile.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ANTHROPIC_API_KEY","ANTHROPIC_VERSION","EDIT_DIRECTOR_MODEL","EDIT_SPEC_API_URL"],"capa3-5-cut-qa.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ANTHROPIC_API_KEY","ANTHROPIC_VERSION","EDIT_DIRECTOR_MODEL","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","EDIT_SPEC_API_URL"],"capa3-edit-director.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ANTHROPIC_API_KEY","ANTHROPIC_VERSION","EDIT_DIRECTOR_MODEL","TELEGRAM_CHAT_ID","EDIT_SPEC_API_URL"],"capa4-render.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","RENDER_SERVICE_URL"],"capa5-review.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","RENDER_SERVICE_URL"],"capa6-publishing.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","PUBLISH_API_URL"],"capa7-metrics.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","METRICS_API_URL"],"capa8-scoring.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","METRICS_API_URL"],"capa9-variant-engine.workflow.json":["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ANTHROPIC_API_KEY","ANTHROPIC_VERSION","EDIT_DIRECTOR_MODEL","VARIANT_DIRECTOR_MODEL","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","EDIT_SPEC_API_URL"]};

test('todos los workflows usan 0. Config y no contienen $env', () => {
  for (const [name, fields] of Object.entries(expected)) {
    const source = fs.readFileSync(path.join(n8nDir, name), 'utf8');
    assert.equal(source.includes('$env.'), false, name);
    const workflow = JSON.parse(source);
    const configs = workflow.nodes.filter((node) => node.name === '0. Config');
    assert.equal(configs.length, 1, name);
    assert.equal(configs[0].type, 'n8n-nodes-base.set');
    const assignments = configs[0].parameters.assignments.assignments;
    assert.deepEqual(assignments.map((item) => item.name), fields);
    for (const item of assignments) {
      if (['ANTHROPIC_VERSION', 'EDIT_DIRECTOR_MODEL', 'VARIANT_DIRECTOR_MODEL'].includes(item.name)) assert.notEqual(item.value, '');
      else assert.equal(item.value, '');
    }
    for (const trigger of workflow.nodes.filter((node) => /Trigger$/.test(node.type) || node.type === 'n8n-nodes-base.webhook')) {
      assert.equal(workflow.connections[trigger.name].main[0][0].node, '0. Config', `${name}: ${trigger.name}`);
    }
  }
});

test('todos los code-nodes sueltos y embebidos son pares y no usan $env', () => {
  for (const name of Object.keys(expected)) {
    const workflow = JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));
    for (const node of workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.code')) {
      assert.ok(node.sourceFile, `${name}: ${node.name}`);
      const loose = fs.readFileSync(path.join(codeDir, node.sourceFile), 'utf8');
      assert.equal(node.parameters.jsCode, loose, `${name}: ${node.name}`);
      assert.equal(loose.includes('$env.'), false, node.sourceFile);
      assert.match(loose, /^const cfg = \$\('0\. Config'\)\.first\(\)\.json;/);
    }
  }
  for (const file of fs.readdirSync(codeDir).filter((item) => item.endsWith('.js'))) {
    assert.equal(fs.readFileSync(path.join(codeDir, file), 'utf8').includes('$env.'), false, file);
  }
});
