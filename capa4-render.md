# Capa 4: disparo automático de render

**Objetivo de esta etapa:** cerrar el ciclo `edit_spec_ready → render automático → MP4 final → estado actualizado → alerta de revisión`, sin tocar templates nuevos — sigue siendo solo `personal_brand_clean`.

**Criterio de éxito:** un video con `edit_spec_ready` termina como MP4 renderizado, con link de revisión y `raw_videos.status = 'rendered_pending_review'`, sin intervención manual.

**Código real:**
- Workflow importable: [`fabrica-reels/n8n/capa4-render.workflow.json`](./fabrica-reels/n8n/capa4-render.workflow.json)
- Nodos Code: [`fabrica-reels/n8n/code-nodes/capa4-*.js`](./fabrica-reels/n8n/code-nodes)
- Render service actualizado: [`fabrica-reels/remotion/src/render/renderService.ts`](./fabrica-reels/remotion/src/render/renderService.ts)
- Migración SQL: [`fabrica-reels/schema/capa4-render.migration.sql`](./fabrica-reels/schema/capa4-render.migration.sql)

---

## Por qué el diseño es asíncrono (decisión de fondo)

Un render de Remotion tarda entre 20s y varios minutos según duración del video y CPU disponible. Atar una conexión HTTP de n8n esperando eso es fragil (timeouts de n8n, de proxies intermedios, de la propia UI si se ejecuta manual). Por eso Capa 4 se separa en dos mitades que se comunican por estado en Supabase, no por una llamada síncrona larga:

1. **Disparo** (`POST /render`): `renderService` responde en milisegundos con un `outcome` (`queued`, `already_done`, `already_in_progress`, `invalid_edit_spec`, etc.) y sigue trabajando en background.
2. **Resultado** (webhook `POST /render-callback`): cuando termina (bien o mal), `renderService` llama de vuelta a un Webhook de n8n con el resultado final.

Una tercera pieza, el **sweep de timeouts**, es la red de seguridad: si `renderService` se cae a mitad de un render y nunca llega a llamar al webhook, un video no puede quedar "colgado" en `rendering` para siempre — el propio Schedule Trigger de Capa 4 revisa cada ciclo si hay renders vencidos y los recupera o los marca como fallidos.

```
n8n (cada 2 min)                          renderService                    n8n (webhook)
─────────────────                         ─────────────                    ─────────────
edit_spec_ready
  → POST /render  ─────────────────────►  valida, encola,
                                           responde YA (outcome)
  ← {outcome:"queued", render_id}  ◄──────┘
raw_videos.status = 'rendering'
                                           (background) renderiza,
                                           sube a Storage,
                                           firma URL de revisión
                                                                    POST /render-callback
                                           ─────────────────────────────────►
                                                                              raw_videos.status =
                                                                              'rendered_pending_review'
                                                                              Telegram: ✅/❌/🔁 (botones)
```

---

## 1. Workflow n8n Capa 4 — nodo por nodo

Un solo workflow, tres entradas independientes:

```
Trigger "Cada 2 min"
  ├─► 0. Sweep renders vencidos (timeout)                 [Code, corre siempre]
  └─► 1. Detectar raw_videos edit_spec_ready               [HTTP GET]
        → Procesar de a uno (render)                        [Loop Over Items]
            → 2. Traer edit_spec listo                       [Code]
            → 3-4. Disparar render y actualizar estado       [Code]
            → (vuelve a "Procesar de a uno")

Webhook "Recibir resultado de render"  (POST /render-callback)
  → 5. Procesar resultado de render                          [Code]
  → 9. Enviar alerta de revisión                              [Telegram, con botones]

Telegram Trigger "Recibir decisión de revisión"  (callback_query)
  → 6. Procesar decisión de revisión                          [Code]
  → ¿Hay que responder?                                       [IF]
      → true → Responder callback_query (Telegram)  → Editar mensaje con la decisión
      → false → (nada, era un update irrelevante)
```

**Por qué esta forma:** el disparo (rama de arriba) y el resultado (webhook) están desacoplados a propósito — así el ciclo sobrevive a que n8n se reinicie a mitad de camino: el estado real vive en `raw_videos.status` y `renders.status`, no en la ejecución de un workflow.

---

## 2. Integración con `renderService.ts`

### Endpoint esperado

`POST {RENDER_SERVICE_URL}/render`

### Payload de entrada

```json
{ "edit_spec_id": "3fa85f64-...-a1b2" }
```

### Respuesta esperada — **siempre HTTP 200** (contrato deliberado)

Decisión de diseño explícita: `POST /render` nunca devuelve 4xx/5xx para resultados "esperados" (ya renderizado, en curso, inválido) — todos vienen como `200` con un campo `outcome`. Esto es a propósito para que el nodo Code de n8n que lo llama nunca tenga que adivinar si `this.helpers.httpRequest` tira excepción en un 4xx o no (varía según versión de n8n) — solo lee `outcome` del body. Los únicos casos que SÍ tiran una excepción real en el nodo de n8n son de red (`renderService` caído/inalcanzable).

| `outcome` | Significa | Qué hace el workflow |
|---|---|---|
| `queued` | Nuevo render encolado | `raw_videos.status = 'rendering'` |
| `already_in_progress` | Ya había un render en curso para este `edit_spec_id` | `raw_videos.status = 'rendering'` (no duplica) |
| `already_done` | Ya existía un render `done` para este `edit_spec_id` | `raw_videos.status = 'rendered_pending_review'` directo, sin esperar webhook |
| `invalid_edit_spec` | Revalidación en Capa 4 falló | `raw_videos.status = 'failed_render_validation'`, no se reintenta solo |
| `not_found` / `missing_input` / `internal_error` | Casos inesperados | tratado como fallo transitorio, reintento acotado (`render_attempts`) |

### Estados de render (`renders.status`)

```
queued → rendering → done
                   → failed   (stage: 'render' | 'upload')
```

### Manejo de errores dentro de `renderService`

- `render` falla (Remotion/Chromium/fuente inaccesible) → `stage:'render'`.
- Render OK pero pesa más que `MAX_RENDER_SIZE_MB` → falla ANTES de intentar subir, `stage:'upload'`, mensaje explícito con el tamaño real.
- Sube bien el archivo pero falla al firmar la URL → `stage:'upload'`.
- Ambos casos llaman al mismo callback de n8n con `status:'failed'` + `stage` + `error`.

### Reintentos seguros

- **Nivel disparo** (n8n): si `renderService` está caído o devuelve algo inesperado, `raw_videos.render_attempts` se incrementa y se reintenta en el próximo ciclo (2 min) hasta 3 veces; al agotar, `failed_render_dispatch` + no más reintentos automáticos.
- **Nivel render** (dentro de `renderService`): no hay reintento automático interno — un render que falla queda `failed` y es una decisión humana (botón "🔁 Reintentar" en Telegram) volver a intentarlo, porque reintentar solo un render que falló por una razón determinística (ej. video fuente corrupto) no cambia el resultado.
- **Nivel timeout** (sweep): un render `queued`/`rendering` de más de 10 minutos se marca `failed` y, si `attempt < 3`, vuelve a `edit_spec_ready` para que el ciclo normal lo recoja de nuevo.

### Idempotencia — no renderizar dos veces el mismo `edit_spec`

`POST /render` busca el último `renders` row por `edit_spec_id` **antes** de crear uno nuevo:
- `status='done'` → devuelve `already_done` con la URL ya existente, cero trabajo nuevo.
- `status IN ('queued','rendering')` → devuelve `already_in_progress`, cero trabajo nuevo.
- Cualquier otro caso (no existe, o el último fue `failed`) → crea una fila nueva con `attempt = anterior + 1`.

Esto cubre tanto "n8n dispara dos veces por un poll solapado" como "alguien apretó Reintentar mientras ya estaba corriendo".

---

## 3. Actualización de Supabase

### Tablas afectadas

`raw_videos`, `renders`, `review_actions` (la mínima escritura de la revisión por Telegram).

### Columnas nuevas (migración)

Ver [`fabrica-reels/schema/capa4-render.migration.sql`](./fabrica-reels/schema/capa4-render.migration.sql):

- `renders`: `raw_video_id`, `public_url`, `error_message`, `stage`, `attempt`, `updated_at`.
- `raw_videos`: `render_attempts`.

### Estados antes/después

| Camino | `raw_videos.status` antes | `raw_videos.status` después |
|---|---|---|
| Disparo aceptado | `edit_spec_ready` | `rendering` |
| Render OK (webhook) | `rendering` | `rendered_pending_review` |
| Render falló (webhook) | `rendering` | `failed_render` \| `failed_upload` |
| Revalidación falló al disparar | `edit_spec_ready` | `failed_render_validation` |
| `renderService` caído, 3 intentos agotados | `edit_spec_ready` | `failed_render_dispatch` |
| Timeout (sweep) | `rendering` | `edit_spec_ready` (reintenta) o `failed_render_timeout` (agotado) |
| Aprobado / Rechazado / Variante (Telegram) | `rendered_pending_review` | `approved` \| `rejected` \| `variant_requested` |

### Storage path del MP4 final y link de revisión

- Bucket **privado** `renders` en Supabase Storage, objeto en `{client_id}/{video_id}.mp4`.
- `renders.storage_path` guarda `renders/{client_id}/{video_id}.mp4` (referencia interna).
- `renders.public_url` guarda una **URL firmada** (`createSignedUrl`, 7 días de validez) — nunca pública directa, porque el contenido es de un cliente. Ese es el link que se manda por Telegram y el que un futuro portal de revisión (Capa 5 real) reutilizaría.

---

## 4. Manejo de errores — tabla completa

| Caso | Dónde se detecta | Qué pasa |
|---|---|---|
| Render service caído | `this.helpers.httpRequest` tira excepción en el nodo "3-4. Disparar render" | `render_attempts++`, reintenta en el próximo ciclo hasta 3 veces, después `failed_render_dispatch` |
| Video source no accesible | Dentro de `renderEditSpec()` (Remotion no puede leer la URL) | `renders.status='failed'`, `stage:'render'`, mensaje con el error real de Remotion/Chromium |
| `edit_spec` inválido al revalidar | `validateEditSpec()` en `POST /render`, antes de encolar | `outcome:'invalid_edit_spec'` con los errores estructurados; `raw_videos.status='failed_render_validation'`, requiere que Capa 3 regenere, no se reintenta solo |
| Fallo de Remotion (crash de Chromium, etc.) | `try/catch` alrededor de `renderEditSpec()` en background | igual que "video source no accesible" — mismo `stage:'render'` |
| Fallo al subir output | `try/catch` separado alrededor del `supabase.storage.upload`/`createSignedUrl` | `renders.status='failed'`, `stage:'upload'` — se distingue de un fallo de render porque el video SÍ se generó, solo no se pudo persistir |
| Timeout de n8n | No aplica a la llamada de disparo (responde en ms); si el render en sí se cuelga, lo cubre el sweep | ver fila "Timeout (sweep)" arriba |
| Render duplicado | `POST /render` busca el último `renders` por `edit_spec_id` antes de crear uno nuevo | `outcome:'already_in_progress'` o `'already_done'`, nunca se crea una segunda fila mientras la anterior sigue viva |
| Archivo demasiado pesado | Chequeo de tamaño (`fs.statSync`) inmediatamente después de renderizar, antes de intentar subir | `renders.status='failed'`, `stage:'upload'`, mensaje con el tamaño real vs. `MAX_RENDER_SIZE_MB` |

---

## 5. Sistema de revisión mínima (deja preparada la Capa 5)

Cuando llega el resultado exitoso al webhook, el mensaje de Telegram incluye el link firmado del video y tres botones inline:

```
🎬 Render listo -- VID-2026-08-16-001
Tiempo de render: 42.3s

Ver video: https://xxxx.supabase.co/storage/v1/object/sign/renders/...

¿Qué hacemos con este video?
[ ✅ Aprobar ] [ ❌ Rechazar ] [ 🔁 Pedir variante ]
```

Cada botón manda un `callback_data` compacto (`appr:<render_id>`, `rejt:<render_id>`, `varr:<render_id>` — dentro del límite de 64 bytes de Telegram). El **Telegram Trigger** del mismo workflow escucha esos clicks, escribe en `review_actions` (con `reviewer` = usuario de Telegram que apretó el botón) y actualiza `raw_videos.status` a `approved` / `rejected` / `variant_requested`, y edita el mensaje original para mostrar la decisión y sacar los botones (evita doble-click).

**Por qué esto "deja preparada" la Capa 5 de verdad:** escribe en la misma tabla `review_actions` que ya estaba diseñada para el portal de revisión (`sistema-fabrica-reels-nexoia.md`, sección 9 y 14) — cuando se construya el portal Next.js, es una fuente de aprobación más sobre el mismo modelo de datos, no un sistema paralelo. El botón "Reintentar" en el mensaje de fallo, además, cierra el loop de error sin que nadie tenga que tocar Supabase a mano: solo vuelve `raw_videos.status` a `edit_spec_ready` y el ciclo normal lo recoge.

---

## 6-7. Documentación de prueba y entregables

### Cómo levantar todo localmente

```bash
# Terminal 1: edit-spec-api (Capa 3, ya existía)
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002

# Terminal 2: render service (Capa 4)
cd fabrica-reels/remotion && npm install
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export N8N_RENDER_CALLBACK_URL=http://localhost:5678/webhook/render-callback
export MAX_RENDER_SIZE_MB=100
npm run render:service   # :3001
```

### Cómo correr un render local (sin n8n, sin Supabase Storage — para desarrollo de templates)

```bash
cd fabrica-reels/remotion
npm run render:local
# Valida sample-data/example-edit-spec.json y renderiza directo a disco
# (fabrica-reels/remotion/out/), sin pasar por el render service ni subir
# nada. Es el camino rápido para iterar sobre PersonalBrandClean.
```

### Cómo correr render vía endpoint (flujo real de Capa 4)

Requiere un `edit_spec_id` real ya guardado por Capa 3 (o insertado a mano para probar):

```bash
# 1. Insertar un edit_spec de prueba directo en Supabase (o dejar que Capa 3 lo genere)
curl -X POST "$SUPABASE_URL/rest/v1/edit_specs" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "{\"raw_video_id\":\"<uuid>\",\"template_id\":\"personal_brand_clean\",\"spec_json\":$(cat fabrica-reels/schema/examples/valid-edit-spec.json),\"version\":1,\"status\":\"ready\",\"validation_status\":\"valid\"}"

# 2. Disparar el render
curl -X POST http://localhost:3001/render \
  -H "Content-Type: application/json" \
  -d '{"edit_spec_id": "<id devuelto arriba>"}'
```

### Ejemplo real de respuesta exitosa

```json
{ "ok": true, "outcome": "queued", "render_id": "b7e2f1a0-..." }
```

Unos segundos/minutos después (según duración del video), `renderService` llama solo al webhook de n8n con:

```json
{
  "render_id": "b7e2f1a0-...",
  "raw_video_id": "9b2f1e3a-...",
  "video_id": "VID-2026-08-16-001",
  "status": "done",
  "public_url": "https://xxxx.supabase.co/storage/v1/object/sign/renders/...",
  "render_time_sec": 42.3
}
```

Consultable en cualquier momento con:

```bash
curl http://localhost:3001/render/b7e2f1a0-...
```

### Ejemplo real de error manejado

Disparando el mismo `edit_spec_id` dos veces seguidas antes de que termine el primero:

```json
{ "ok": true, "outcome": "already_in_progress", "render_id": "b7e2f1a0-..." }
```

Con un `edit_spec_id` cuyo `spec_json` fue editado a mano y quedó con `branding.handle` sin `@`:

```json
{
  "ok": false,
  "outcome": "invalid_edit_spec",
  "errors": [
    { "path": "branding.handle", "message": "El handle debe empezar con @ y tener 2-30 caracteres" }
  ]
}
```

### Checklist de QA — Capa 4 lista cuando:

- [ ] `renderService` responde `{ok:true}` en `GET /health`.
- [ ] `POST /render` con un `edit_spec_id` real devuelve `outcome:"queued"` y, tras el tiempo de render, el webhook de n8n recibe `status:"done"` con `public_url` accesible (el link firmado abre el MP4).
- [ ] Repetir el mismo `POST /render` mientras el primero sigue corriendo devuelve `already_in_progress` — no se crea una segunda fila en `renders`.
- [ ] Repetir el mismo `POST /render` después de que terminó devuelve `already_done` con la misma `public_url` — no se vuelve a renderizar.
- [ ] Con `renderService` apagado, el workflow de n8n reintenta hasta 3 veces (ver `raw_videos.render_attempts` subir) y después deja `failed_render_dispatch` + no sigue reintentando solo.
- [ ] Forzando un `edit_spec` inválido directo en la tabla, `POST /render` responde `invalid_edit_spec` y `raw_videos.status` queda en `failed_render_validation`.
- [ ] Matando `renderService` a mitad de un render (simular timeout): el sweep del próximo ciclo (máx. 12 min de espera) detecta el `renders` colgado y lo recupera o lo marca `failed_render_timeout` según los intentos ya usados.
- [ ] El mensaje de Telegram de éxito llega con los 3 botones y el link abre el video; apretar cada botón escribe en `review_actions`, actualiza `raw_videos.status` y edita el mensaje mostrando la decisión (sin dejar los botones activos para un segundo click).
- [ ] El botón "🔁 Reintentar" del mensaje de fallo efectivamente vuelve el video a `edit_spec_ready` y el ciclo normal lo re-dispara sin intervención manual adicional.
- [ ] Un video corrido de punta a punta (Capa 3 completa → Capa 4 completa) termina en `rendered_pending_review` con un MP4 real y reproducible, sin que nadie haya tocado Supabase ni Remotion a mano.
