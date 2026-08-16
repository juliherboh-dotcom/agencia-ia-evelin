# Capa 3: workflow n8n "Edit Director"

**Objetivo de esta etapa:** cerrar la tubería `video bruto → transcripción → Edit Director → edit_spec válido → Supabase → listo para renderizar con PersonalBrandClean`, sin tocar todavía templates nuevos.

**Código real:**
- Workflow importable: [`fabrica-reels/n8n/capa3-edit-director.workflow.json`](./fabrica-reels/n8n/capa3-edit-director.workflow.json)
- Nodos Code como archivos sueltos: [`fabrica-reels/n8n/code-nodes/`](./fabrica-reels/n8n/code-nodes)
- Servicio compartido de validación/prompts: [`fabrica-reels/services/edit-spec-api/`](./fabrica-reels/services/edit-spec-api)
- Prompts: [`fabrica-reels/prompts/`](./fabrica-reels/prompts)

---

## 1. El workflow, nodo por nodo

```
Cada 5 min
  → 1. Detectar videos listos (assets_ready)      [HTTP GET raw_videos]
  → Procesar de a uno                              [Loop Over Items, batch=1]
      → 2-3. Traer contexto + armar prompt          [Code]
      → 4. Llamar LLM (Edit Director)                [Code]  ◄─────────┐
      → 5-6. Validar edit_spec                       [Code]            │
      → ¿Válido?                                     [IF]              │
          ├─ true                                                      │
          │    → 7. Guardar edit_spec en Supabase    [Code]            │
          │    → 8. Actualizar estado -> edit_spec_ready [Code]        │
          │    → 9. Alertar: listo para renderizar   [Telegram]        │
          │    → (vuelve a "Procesar de a uno")                        │
          └─ false                                                     │
               → ¿Quedan intentos de reparación? (attempt < 3) [IF]     │
                   ├─ true                                             │
                   │    → Repair loop: construir prompt de reparación [Code]
                   │    → (vuelve a "4. Llamar LLM (Edit Director)") ──┘
                   └─ false
                        → Marcar failed_edit_spec_generation [Code]
                        → Alertar: falló la generación        [Telegram]
                        → (vuelve a "Procesar de a uno")
```

**Por qué el nodo "4. Llamar LLM" se reutiliza para reparación:** es un nodo genérico — lee `system_prompt`/`user_prompt` del item y llama al LLM, sin saber si es el intento 1 o el 3. El nodo "Repair loop" simplemente reescribe esos dos campos (con el prompt correctivo) y el `attempt` antes de volver a conectarse ahí. Esto es lo que cierra el ciclo sin duplicar el nodo de llamada al LLM.

**Por qué cada nodo Code hace sus propias llamadas HTTP (`this.helpers.httpRequest`) en vez de usar nodos HTTP Request nativos encadenados:** porque un HTTP Request node de n8n reemplaza el `$json` del item con la respuesta de la API, y este flujo necesita ir acumulando contexto (video, transcripción, intento, prompts) a lo largo de 6-7 pasos. Haciendo el fetch dentro del propio Code node, cada uno controla exactamente qué conserva y qué agrega (`{...$json, nuevo_campo}`), sin depender de mecanismos de merge del nodo HTTP Request que varían entre versiones de n8n.

---

## 2. Prompt Edit Director — archivo completo

[`fabrica-reels/prompts/edit-director-system-prompt.md`](./fabrica-reels/prompts/edit-director-system-prompt.md) — cubre rol, objetivo, reglas duras, reglas creativas, criterios de cortes/hook/subtítulos/overlays/zoom, selección de template y salida obligatoria. Se sirve armado (junto con la voz de marca) desde `edit-spec-api` en `GET /prompts/edit-director-system`, así el archivo `.md` es la única fuente de verdad — nada de texto de prompt duplicado dentro del JSON del workflow.

Resumen de la estructura (el archivo completo tiene el detalle de cada sección):

| Sección | Qué fija |
|---|---|
| ROL | Genera el plano de edición, no edita — el JSON es el único puente hacia Remotion |
| OBJETIVO | Un `edit_spec` completo y válido, template fijo `personal_brand_clean` |
| REGLAS DURAS | Solo JSON, sin texto extra; dos líneas de tiempo distintas (fuente vs. final); tolerancia de duración ±20%; cortes sin solape ni huecos; hook ≤4s; branding exacto del brand kit; respetar safe areas |
| REGLAS CREATIVAS | Cortar silencios/muletillas sin partir ideas; "cada segundo que queda tiene que estar" |
| Criterios por campo | cortes, hook, subtítulos, overlays, zoom — reglas concretas y acotadas (ver archivo) |
| Selección de template | Fijo en este flujo: `personal_brand_clean` |
| Salida obligatoria | Solo el JSON; los campos "fijos" (ids, branding, meta) se copian del mensaje de usuario tal cual |

## 3. Voz de marca Nexo.IA — archivo completo

[`fabrica-reels/prompts/nexoia-brand-voice.md`](./fabrica-reels/prompts/nexoia-brand-voice.md) — tono, estilo visual, tipo de hooks, temas prioritarios, qué evitar, cómo hablarle a cada audiencia. Se concatena al prompt genérico en `edit-spec-api`; para un cliente nuevo de la agencia, este es el único archivo que se reemplaza — la estructura y las reglas duras del Edit Director no cambian.

## Prompt de reparación

Ya existe desde la Capa 3→4 (`fabrica-reels/validation/repair-prompt.ts`), servido acá también vía `POST /repair-prompt` de `edit-spec-api`. No se duplicó: el nodo "Repair loop" del workflow lo llama por HTTP en vez de reimplementar la lógica en JS dentro de n8n.

---

## 4. Ejemplo real: transcripción → edit_spec → validación → Supabase

**Input — extracto de `transcripts.words`** (timestamps en la línea de tiempo del video FUENTE, tal como lo devuelve Whisper):

```json
[
  { "word": "Esto",        "start": 0.00, "end": 0.32 },
  { "word": "cambió",      "start": 0.35, "end": 0.71 },
  { "word": "mi",          "start": 0.74, "end": 0.85 },
  { "word": "forma",       "start": 0.88, "end": 1.15 },
  { "word": "de",          "start": 1.17, "end": 1.28 },
  { "word": "vender,",     "start": 1.31, "end": 1.78 },
  { "word": "y",           "start": 2.60, "end": 2.68 },
  { "word": "no",          "start": 2.71, "end": 2.85 },
  { "word": "fue",         "start": 2.88, "end": 3.05 },
  { "word": "con",         "start": 3.08, "end": 3.22 },
  { "word": "más",         "start": 3.25, "end": 3.42 },
  { "word": "publicidad.", "start": 3.45, "end": 4.10 },
  { "word": "...",         "start": 4.10, "end": 8.95 },
  { "word": "eh,",         "start": 9.05, "end": 9.40 },
  { "word": "o",           "start": 27.05, "end": 27.15 },
  { "word": "sea,",        "start": 27.15, "end": 27.45 }
]
```

*(extracto ilustrativo — el array real cubre los 45s completos del bruto, palabra por palabra)*

Junto con `analyses` (`tema: "cómo cambié mi forma de vender"`, `categoria: "autoridad"`, `hook_score: 7`) y `assets` (hooks alternativos, captions) ya generados en Capas 1-2, más el `brand_kit` de Nexo.IA.

**Output — `edit_spec` que devuelve el Edit Director** (mismo ejemplo que ya se usa como `valid-edit-spec.json` — es literalmente el mismo caso, contado de punta a punta):

Ver [`fabrica-reels/schema/examples/valid-edit-spec.json`](./fabrica-reels/schema/examples/valid-edit-spec.json) — nota cómo `hook.text`, `subtitles.lines[0]` y los primeros `cuts` se corresponden con el extracto de arriba: el silencio `4.10-8.95` y la muletilla `27.05-27.45` son exactamente los tramos que el `edit_spec` marca como `"keep": false`.

**Validación:**

```
POST http://localhost:3002/validate
{ "edit_spec": <el JSON de arriba> }

→ 200 OK
{ "valid": true, "data": { ...mismo edit_spec... } }
```

**Guardado en Supabase** (`fabrica-reels/n8n/code-nodes/08-guardar-edit-spec.js`) — inserta en `edit_specs`:

```json
{
  "raw_video_id": "9b2f1e3a-6c4d-4a2b-8e1f-2d3c4b5a6e7f",
  "template_id": "personal_brand_clean",
  "spec_json": { "...": "el edit_spec completo" },
  "schema_version": "1.0.0",
  "version": 1,
  "status": "ready",
  "validation_status": "valid",
  "repair_attempts": 0
}
```

Y `raw_videos.status` pasa de `assets_ready` a `edit_spec_ready`. Telegram recibe: *"✅ edit_spec listo — VID-2026-08-16-001 (instagram_reels) queda en estado edit_spec_ready, esperando render con personal_brand_clean. Intentos usados: 1."*

---

## 5. Integración técnica

### Nodos n8n usados

| Nodo | Tipo n8n | Rol |
|---|---|---|
| Cada 5 min | `scheduleTrigger` | dispara el poll |
| 1. Detectar videos listos | `httpRequest` | GET a PostgREST, `status=eq.assets_ready` |
| Procesar de a uno | `splitInBatches` (batch=1) | procesa un video completo (incluido su repair loop) antes de pasar al siguiente |
| 2-3, 4, 5-6, 7, 8, Repair loop, Marcar failed | `code` (JS, "Run Once for Each Item") | toda la lógica de negocio — ver `code-nodes/` |
| ¿Válido? / ¿Quedan intentos? | `if` | ramas del flujo |
| 9. Alertar listo / Alertar falló | `telegram` | notificaciones |

### Payloads HTTP clave

**GET videos listos** (PostgREST):
```
GET {SUPABASE_URL}/rest/v1/raw_videos?status=eq.assets_ready&select=id,client_id,filename,storage_path,duration_sec,uploaded_at&order=uploaded_at.asc
```

**POST validación** (`edit-spec-api`):
```
POST {EDIT_SPEC_API_URL}/validate
{ "edit_spec": { ... } }
→ { "valid": true, "data": {...} } | { "valid": false, "errors": [{path, message}] }
```

**POST reparación** (`edit-spec-api`):
```
POST {EDIT_SPEC_API_URL}/repair-prompt
{ "edit_spec": {...último intento...}, "errors": [...] }
→ { "system": "...", "user": "..." }
```

**POST al LLM** (Anthropic Messages API):
```
POST https://api.anthropic.com/v1/messages
{ "model": "...", "max_tokens": 4096, "temperature": 0.4, "system": "...", "messages": [{"role":"user","content":"..."}] }
```

### Variables de entorno

| Variable | Ejemplo | Uso |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | REST de Supabase (PostgREST) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | auth de service role (el workflow escribe en tablas protegidas por RLS) |
| `EDIT_SPEC_API_URL` | `http://localhost:3002` | validación + prompts |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | llamada al Edit Director |
| `ANTHROPIC_VERSION` | `2023-06-01` | header requerido por la API de Anthropic |
| `EDIT_DIRECTOR_MODEL` | `claude-sonnet-4-5-...` | ajustar al modelo vigente en el momento de desplegar |
| `TELEGRAM_CHAT_ID` | `-100123456789` | destino de las alertas (la credencial del bot se configura aparte, en n8n) |

### Endpoint del render service

Este workflow **no llama** al render service (`fabrica-reels/remotion/src/render/renderService.ts`, `:3001`) — termina en `edit_spec_ready`. Disparar el render es un paso separado (Capa 4, ya construida) que se conecta después: o bien un segundo workflow n8n que hace poll de `raw_videos.status=edit_spec_ready` y llama `POST :3001/render`, o el mismo Telegram de "listo para renderizar" como gatillo manual mientras se prueba. Se deja así a propósito, siguiendo el alcance de esta etapa.

### Tabla que se actualiza

`raw_videos.status`, y se inserta una fila en `edit_specs` (`spec_json`, `template_id`, `version`, `status`, `validation_status`, `repair_attempts`, `validation_errors`) — mismas tablas definidas en `sistema-fabrica-reels-nexoia.md` sección 9, extendidas en `fabrica-reels/schema/edit-specs.migration.sql`.

### Estados antes/después

| Camino | `raw_videos.status` antes | `raw_videos.status` después |
|---|---|---|
| Éxito (1-3 intentos) | `assets_ready` | `edit_spec_ready` |
| Agotó los 3 intentos | `assets_ready` | `failed_edit_spec_generation` (requiere revisión humana) |

---

## 6. Manejo de errores

| Caso | Dónde se detecta | Qué pasa |
|---|---|---|
| LLM devuelve JSON inválido (no parsea) | Nodo "4. Llamar LLM" (try/catch de `JSON.parse`) | `parse_ok:false`; el nodo "5-6. Validar" arma el error sin llamar a `/validate`; entra al repair loop igual que cualquier otro inválido |
| Timestamps fuera de rango | `validateEditSpec` — capa semántica (`cuts[].end > source_video.duration_sec`, `subtitles.lines[].end > duration.target_sec`) | Error estructurado con `path` exacto; entra al repair loop |
| Cortes solapados | `validateEditSpec` — capa semántica | Idem — mensaje indica cuál corte se solapa con cuál |
| Safe areas inválidas | `validateEditSpec` — capa semántica (`isWithinSafeArea`) | Idem — mensaje indica que la posición cae fuera del área segura de la plataforma |
| Video sin hook claro | No es un error de *schema* — es una señal de calidad previa | Si `analysis.hook_score` viene bajo (<5) desde la Capa 2, es una decisión de producto, no de este workflow: igual se genera el `edit_spec` (con el hook que haya), pero queda como candidato a "Descartar/Mejorar" en el reporte semanal (sección 19 de `sistema-fabrica-reels-nexoia.md`) — este workflow no bloquea por hook débil, solo por JSON inválido |
| Transcripción demasiado larga | Nodo "2-3. Traer contexto" no la trunca hoy | Riesgo conocido: un bruto muy largo (>3-4 min) puede acercarse al límite de contexto del prompt. Mitigación pendiente: truncar `wordsFormatted` a los primeros N minutos o resumir tramos intermedios — no implementado en este MVP de la Capa 3, documentado como límite conocido |
| Falla de Supabase (red, RLS, tabla inexistente) | Cualquier `this.helpers.httpRequest` a `SUPABASE_URL` | n8n marca el nodo en error; con "Retry On Fail" configurado (recomendado: 2 reintentos, 5s de espera) se resuelve solo si fue un blip de red. Si persiste, la ejecución queda visible como fallida en el historial de n8n — no hay alerta automática todavía para este caso particular, queda como mejora de Capa 11 (observabilidad) |
| Falla del render service | No aplica a este workflow (no lo llama) | Se maneja en el workflow de Capa 4 (`renderService.ts` ya devuelve 422/500 estructurados) |
| Se agotan los 3 intentos de reparación | Nodo "¿Quedan intentos?" (`attempt < 3` false) | Se guarda el último intento fallido en `edit_specs` (auditoría, nunca se borra), `raw_videos.status = failed_edit_spec_generation`, alerta Telegram con los últimos errores — requiere revisión humana, el sistema no reintenta solo después de esto |

---

## 7. Entregables

- [x] Workflow n8n importable: [`fabrica-reels/n8n/capa3-edit-director.workflow.json`](./fabrica-reels/n8n/capa3-edit-director.workflow.json)
- [x] Prompt Edit Director: [`fabrica-reels/prompts/edit-director-system-prompt.md`](./fabrica-reels/prompts/edit-director-system-prompt.md)
- [x] Voz de marca Nexo.IA: [`fabrica-reels/prompts/nexoia-brand-voice.md`](./fabrica-reels/prompts/nexoia-brand-voice.md)
- [x] Prompt de reparación: [`fabrica-reels/validation/repair-prompt.ts`](./fabrica-reels/validation/repair-prompt.ts) (servido vía `edit-spec-api`)
- [x] Servicio `edit-spec-api` (`/validate`, `/repair-prompt`, `/prompts/edit-director-system`): [`fabrica-reels/services/edit-spec-api/`](./fabrica-reels/services/edit-spec-api)

### Cómo probarlo localmente

```bash
# 1. Levantar el servicio de validación/prompts
cd fabrica-reels/services/edit-spec-api
npm install
npm start   # :3002

# 2. Probar el prompt armado
curl http://localhost:3002/prompts/edit-director-system | jq -r .text | head -20

# 3. Probar la validación con el ejemplo válido
curl -X POST http://localhost:3002/validate \
  -H "Content-Type: application/json" \
  -d "{\"edit_spec\": $(cat ../../schema/examples/valid-edit-spec.json)}"
# → {"valid": true, "data": {...}}

# 4. Probar con el ejemplo inválido
curl -X POST http://localhost:3002/validate \
  -H "Content-Type: application/json" \
  -d "{\"edit_spec\": $(cat ../../schema/examples/invalid-edit-spec.json)}"
# → {"valid": false, "errors": [{"path":"branding.handle", "message":"..."}]}

# 5. Probar el prompt de reparación con esos mismos errores
curl -X POST http://localhost:3002/repair-prompt \
  -H "Content-Type: application/json" \
  -d "{\"edit_spec\": $(cat ../../schema/examples/invalid-edit-spec.json), \"errors\": [{\"path\":\"branding.handle\",\"message\":\"El handle debe empezar con @\"}]}"
```

Recién con `edit-spec-api` respondiendo, importar el workflow en n8n, cargar las env vars, y correrlo manualmente ("Execute Workflow") contra un `raw_video` real en estado `assets_ready` antes de activarlo con el schedule trigger.

### Checklist de QA — Capa 3 lista cuando:

- [ ] `edit-spec-api` responde `200` en `/health`, `/prompts/edit-director-system`, y valida correctamente los dos ejemplos (`valid-edit-spec.json` → `valid:true`, `invalid-edit-spec.json` → `valid:false` con el error de `branding.handle`).
- [ ] Con un `raw_video` real de prueba en `assets_ready` (con `transcripts.words`, `analyses`, `assets`, `brand_kit` ya cargados), el workflow corre de punta a punta sin intervención manual y el video queda en `edit_spec_ready`.
- [ ] El `edit_spec` guardado pasa `validateEditSpec()` de nuevo si se lo vuelve a validar manualmente (no solo confiar en que pasó una vez).
- [ ] Forzando un JSON inválido (por ejemplo, bajando `EDIT_DIRECTOR_MODEL` a un modelo que ignore instrucciones de formato, o inyectando un error a propósito en el prompt), el repair loop corre hasta 3 intentos y, si no se resuelve, el video queda en `failed_edit_spec_generation` con la fila de auditoría en `edit_specs` (`validation_status='invalid'`) y llega la alerta de Telegram.
- [ ] Los dos casos (éxito y fallo agotado) devuelven el control a "Procesar de a uno" y el workflow sigue con el siguiente video de la cola sin quedar colgado.
- [ ] `raw_videos.status` nunca queda en un estado intermedio inconsistente si se interrumpe la ejecución de n8n a mitad de camino (revisar manualmente: un video en `assets_ready` que no avanzó, simplemente se vuelve a recoger en el próximo poll de 5 minutos — es idempotente mientras no haya insertado ya un `edit_specs` válido).
- [ ] Alertas de Telegram llegan con datos legibles (no `[object Object]`) tanto en el caso de éxito como en el de fallo.
