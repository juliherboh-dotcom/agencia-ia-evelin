# Capa 5: sistema de revisión y aprobación

**Objetivo:** convertir el MP4 renderizado en una pieza revisable, aprobable y lista para publicación. Funciona hoy 100% por Telegram, pero el modelo de datos está diseñado para que un portal web (Capa 11) se enchufe después sin cambiar nada de lo que ya existe.

**Criterio de éxito:** un video en `rendered_pending_review` puede aprobarse, rechazarse o marcarse para variante desde Telegram, y Supabase queda actualizado correctamente para que la Capa 6 de publicación lo tome sin intervención manual.

**Código real:**
- Workflow importable: [`fabrica-reels/n8n/capa5-review.workflow.json`](./fabrica-reels/n8n/capa5-review.workflow.json)
- Nodos Code: [`fabrica-reels/n8n/code-nodes/capa5-*.js`](./fabrica-reels/n8n/code-nodes)
- Migración SQL: [`fabrica-reels/schema/capa5-review.migration.sql`](./fabrica-reels/schema/capa5-review.migration.sql)
- Ajustes a Capa 4: [`fabrica-reels/n8n/capa4-render.workflow.json`](./fabrica-reels/n8n/capa4-render.workflow.json) (regenerado, ver sección "Ajustes a Capa 4")

---

## 1. Modelo completo de revisión

### Estados de revisión (`raw_videos.status`, tramo de Capa 5)

```
rendered_pending_review
   │
   ├─ Aprobar ────────────────────────────► approved_for_publish
   │
   ├─ Rechazar ─► (awaiting_comment) ──────► rejected
   │
   ├─ Pedir cambios manuales ─► (awaiting_comment) ──► needs_changes
   │
   ├─ Marcar como error ─► (awaiting_comment, obligatorio) ──► error_flagged
   │
   ├─ Pedir variante automática
   │     └─► (awaiting_variant_type) ─► elegir tipo ─► (awaiting_comment) ──► variant_requested
   │
   ├─ Volver a renderizar ─────────────────► edit_spec_ready   (vuelve a Capa 4)
   │
   └─ Regenerar link ──────────────────────► (sin cambio de estado, solo refresca renders.public_url)
```

**Detalle importante:** los pasos `(awaiting_variant_type)` y `(awaiting_comment)` **no** son valores de `raw_videos.status` — el video se queda en `rendered_pending_review` durante toda la conversación. El estado transitorio vive en `review_sessions`, no en `raw_videos`. Esto evita que un video quede en un estado raro si alguien empieza a rechazar y nunca termina de escribir el motivo — sigue apareciendo como "pendiente de revisión" hasta que la decisión se termina de tomar (o expira, ver sección 8).

### Quién revisa

Tabla `reviewers`: cada fila es una persona habilitada para revisar videos de un `client_id` puntual, identificada por su `telegram_user_id` (el ID numérico de Telegram, **no** el `@username`, que puede cambiar). Sin una fila activa en `reviewers` para el cliente dueño del video, cualquier botón que se apriete devuelve "🚫 No tenés permiso" y no escribe nada en Supabase.

### Cuándo revisa

En cuanto `raw_videos.status = 'rendered_pending_review'` y todavía no se mandó el mensaje (`review_prompt_sent_at IS NULL`), el poller de Capa 5 (cada 1 minuto) lo manda. No hay ventana de "horario de revisión" — si se necesita eso, es una regla a nivel de cliente que se agrega después, no una limitación del modelo.

### Comentarios del revisor / motivo de rechazo

Se guardan en `review_actions.comment` (texto libre). No hay una taxonomía estructurada de "motivos" separada del comentario — se decidió así a propósito para no construir un selector de categorías sin una interfaz real que lo use bien todavía; el comentario libre es suficiente para el volumen actual y para lo que necesita leer un humano en el reporte semanal.

### Tipo de cambio solicitado

`review_actions.variant_type`, solo se llena cuando `decision = 'variant_requested'`. Ver sección 6 para los 6 tipos soportados.

### Historial de acciones

`review_actions` es un log **append-only** — nunca se actualiza ni se borra una fila. Cada decisión (incluidas las que expiraron solas) queda registrada con `reviewer`, `decision`, `comment`, `variant_type`, `session_id` (si vino de una conversación) y `decided_at`. Es el mismo principio que ya se usa en `edit_specs` (nunca se pisan versiones) — la auditoría completa siempre está disponible.

### Relación con las demás tablas

```
raw_videos ──1:N── edit_specs ──1:N── renders ──1:N── review_actions
                                          │                  │
                                          │            (session_id, nullable)
                                          │                  │
                                          └──────────── review_sessions
                                          │
                                          └──1:N (al aprobar)── publications  (Capa 6)
```

Un `render_id` puede tener varias filas en `review_actions` a lo largo del tiempo (ej. una sesión que expiró y se volvió a intentar), pero `raw_videos.status` siempre refleja la última decisión real.

---

## 2. Migración SQL

Ver [`fabrica-reels/schema/capa5-review.migration.sql`](./fabrica-reels/schema/capa5-review.migration.sql) completa. Resumen:

| Cambio | Detalle |
|---|---|
| Tabla nueva `reviewers` | permisos por cliente, único índice `(client_id, telegram_user_id)` |
| Tabla nueva `review_sessions` | estado transitorio de conversación (comentario / tipo de variante pendiente) |
| `review_actions` extendida | `reviewer_id`, `variant_type`, `session_id` |
| `raw_videos` extendida | `review_prompt_sent_at` |
| `clients` extendida | `telegram_chat_id` (multi-tenant real de las alertas) |
| `publications` extendida | `raw_video_id` (ya existía la tabla desde la arquitectura original — no se creó `publish_jobs` nueva, ver nota abajo) |
| Índices | `review_sessions` por `(chat_id, status)` y por `(status, expires_at)` para el sweep; `review_actions` por `render_id`; `publications` por `status` |
| RLS | activado en las 3 tablas nuevas/tocadas, política `service_role` para n8n/renderService; plantilla comentada para cuando exista el portal (Capa 11) |

**Nota de continuidad:** el pedido original menciona "sugerir estructura inicial de `publish_jobs`" — esa tabla **ya existe** como `publications`, definida en `sistema-fabrica-reels-nexoia.md` sección 9, con exactamente ese propósito (`render_id`, `client_id`, `platform`, `caption_used`, `hashtags_used`, `status`, `scheduled_at`, `published_at`, `external_post_id`). Crear una tabla nueva hubiera duplicado el mismo concepto con otro nombre — en vez de eso, esta migración solo le agrega `raw_video_id` para poder consultarla sin pasar siempre por `render_id`, y el flujo de "Aprobar" (sección 7) la puebla directamente.

---

## 3. Workflow n8n Capa 5

```
Trigger "Cada 1 min"
  ├─► 0. Enviar revisiones pendientes    [Code, runOnceForAllItems]
  └─► 1. Sweep sesiones de comentario vencidas  [Code, runOnceForAllItems]

Telegram Trigger "Recibir interacciones de revisión"  (callback_query, message)
  → 2. Rutear interacción de revisión    [Code, runOnceForEachItem]
```

Solo 5 nodos — deliberadamente compacto. Todo lo que en Capa 3/4 hubiera sido una cadena de nodos IF + nodos nativos de Telegram, acá vive como funciones bien separadas **dentro** del nodo "2. Rutear interacción", que hace sus propias llamadas a la Bot API de Telegram vía `this.helpers.httpRequest` en vez de depender de nodos nativos — mismo criterio que el resto de la Fábrica de Reels, y evita toda la incertidumbre de nombres de parámetros de los nodos `n8n-nodes-base.telegram` entre versiones.

### Interpretar `callback_data`

| Prefijo | Acción | Requiere sesión previa |
|---|---|---|
| `appr:<render_id>` | Aprobar | No |
| `rejt:<render_id>` | Rechazar | Abre sesión (pide comentario) |
| `chng:<render_id>` | Pedir cambios manuales | Abre sesión (pide comentario) |
| `errf:<render_id>` | Marcar como error | Abre sesión (comentario obligatorio) |
| `varr:<render_id>` | Pedir variante automática | Abre sesión (pide tipo, después comentario) |
| `vt:<code>:<render_id>` | Tipo de variante elegido | Continúa la sesión abierta por `varr` |
| `rlnk:<render_id>` | Regenerar link | No |
| `rrnd:<render_id>` | Volver a renderizar | No |
| `retr:<raw_video_id>` | Reintentar un render que **falló** (viene del mensaje de fallo de Capa 4) | No |

### Pedir comentario si se rechaza o pide variante

`startCommentSession()` manda un mensaje nuevo pidiendo el texto, crea una fila en `review_sessions` con `status='awaiting_comment'`, y edita el mensaje original (saca los botones, para que no se pueda clickear de nuevo). El siguiente mensaje de texto que llegue de ese `chat_id` con una sesión `awaiting_comment` activa se interpreta como el comentario — no hace falta que sea una respuesta ("reply") formal, alcanza con que sea el próximo texto en ese chat.

### Confirmar al usuario

Cada acción, al finalizar, edita el mensaje original (o manda uno nuevo) confirmando qué se decidió y quién lo decidió (`telegram:@usuario`).

### Manejar acciones duplicadas / decisiones tardías

Antes de procesar cualquier acción que requiera que el video siga pendiente (`appr`, `rejt`, `chng`, `errf`, `varr`, `rrnd`, `vt`), se relee `raw_videos.status`. Si ya no es `rendered_pending_review` (porque otra persona ya decidió, o porque expiró y se auto-finalizó), responde "⚠️ Este video ya fue procesado" y no escribe nada — un solo chequeo cubre "callback duplicado", "video ya aprobado" y "video ya rechazado" al mismo tiempo.

### Links expirados de Supabase Storage

No hay forma de detectar del lado del servidor que un link ya venció (eso pasa en el navegador del revisor). La mitigación es el botón "🔗 Regenerar link", que llama al nuevo endpoint `POST /renders/:id/refresh-link` de `renderService` (re-firma el mismo objeto sin volver a renderizar) y manda el link nuevo por Telegram.

---

## Ajustes a Capa 4

Capa 4 (`capa4-render.workflow.json`) se **regeneró**: pasó de 14 a 8 nodos. Se quitaron los 6 nodos que manejaban botones de revisión (`9. Enviar alerta de revisión`, `Recibir decisión de revisión`, `6. Procesar decisión de revisión`, `¿Hay que responder?`, `Responder callback_query`, `Editar mensaje con la decisión`) — esa responsabilidad ahora es 100% de Capa 5.

Lo que le queda a Capa 4: disparar renders, el sweep de timeouts, y — en el webhook de resultado — actualizar `raw_videos.status` y, **solo si el render falló**, avisar por Telegram con un botón "🔁 Reintentar" (`retr:<raw_video_id>`, ahora procesado por Capa 5). Un render exitoso ya no dispara ningún mensaje desde Capa 4 — el poller de Capa 5 es quien manda la revisión interactiva.

**Si ya tenías la v1 de Capa 4 importada y activa en n8n**, hay que desactivarla y reimportar esta versión — si quedan las dos activas al mismo tiempo, un mismo `callback_query` de Telegram puede llegarle a los dos Telegram Trigger (el viejo de Capa 4 y el nuevo de Capa 5) y procesarse dos veces.

---

## 4. Diseño preparado para portal web (Capa 11, no se construye ahora)

El modelo de datos de esta capa ya es "API-ready" — un portal Next.js necesitaría estos endpoints, todos triviales sobre las tablas que ya existen (vía PostgREST directo o una capa fina de API routes):

| Endpoint | Query base |
|---|---|
| `GET /videos/pending` | `raw_videos?status=eq.rendered_pending_review&client_id=eq.{client}` + join a `renders` (`status=eq.done`, el más reciente) |
| `GET /videos/:id/history` | `review_actions?render_id=eq.{render_id}&order=decided_at.desc` |
| `POST /videos/:id/approve` | mismo que `finalizeImmediate` del nodo Code: insert en `review_actions` + patch `raw_videos.status` + insert en `publications` |
| `POST /videos/:id/reject` `{comment}` | mismo que `finalizeWithComment`, sin pasar por `review_sessions` (el portal no necesita el paso conversacional, tiene un formulario) |
| `POST /videos/:id/request-variant` `{variant_type, comment}` | idem, con `variant_type` ya elegido por UI en vez de por botones |
| `POST /videos/:id/refresh-link` | proxy directo a `renderService POST /renders/:id/refresh-link` |
| `POST /videos/:id/rerender` | `raw_videos.status = 'edit_spec_ready'` |

**Qué datos debe mostrar:** video (`public_url`), transcripción/caption/hashtags (`assets`), score de calidad previo (`analyses`), historial completo (`review_actions`), y quién más revisó (`reviewers` del mismo `client_id`, para mostrar "revisado por" con nombre en vez de ID de Telegram).

**Cómo listar pendientes:** exactamente la misma query que usa el nodo "0. Enviar revisiones pendientes" (`status=eq.rendered_pending_review`), sin el filtro de `review_prompt_sent_at` (eso es específico de "no mandar el mismo mensaje de Telegram dos veces", el portal simplemente los lista todos).

**Cómo mostrar historial:** `review_actions` ya tiene todo — un timeline de `{reviewer, decision, comment, variant_type, decided_at}` ordenado por fecha se arma directo, sin transformación.

**Cómo pedir variante:** el portal no necesita el paso de dos mensajes de Telegram — un formulario con un `<select>` de los 6 tipos + un `<textarea>` de comentario manda todo junto en un solo `POST`. El `review_sessions` conversacional es un detalle de implementación de la interfaz por chat, no del modelo de datos.

**Cómo regenerar signed URL:** el portal llama al mismo endpoint de `renderService` que usa el botón de Telegram — es lógica que ya vive en la Capa 4, no hay que duplicarla.

---

## 5. Acciones de revisión — resumen ejecutable

| Acción | `raw_videos.status` resultante | Comentario | Efecto adicional |
|---|---|---|---|
| Aprobar | `approved_for_publish` | No | Crea fila en `publications` (`status='queued'`) |
| Rechazar | `rejected` | Opcional | — |
| Pedir variante automática | `variant_requested` | Opcional | Guarda `variant_type` |
| Pedir cambios manuales | `needs_changes` | Opcional | — |
| Regenerar link | (sin cambio) | — | Re-firma la URL en `renders.public_url` |
| Marcar como error | `error_flagged` | **Obligatorio** | — |
| Volver a renderizar | `edit_spec_ready` | No | Resetea `render_attempts`, vuelve a Capa 4 |

---

## 6. Integración con variantes

Cuando se elige "Pedir variante automática", el segundo paso obliga a elegir un tipo (no hay "variante genérica" sin especificar):

| Código interno | Tipo | Qué implica (cuando exista el motor real, Capa 9) |
|---|---|---|
| `nuevo_hook` | Nuevo hook | Re-cortar el mismo bruto con otro hook de `assets.hooks_alternativos` — variante Tipo B, sin volver a grabar |
| `subtitulos_agresivos` | Subtítulos más agresivos | Nuevo `edit_spec` con más `emphasis:true` y estilo más grande — Tipo B |
| `version_mas_corta` | Versión más corta | Nuevo `edit_spec` con `duration.target_sec` menor y cortes más agresivos — Tipo B |
| `version_mas_limpia` | Versión más limpia | Menos overlays/zoom, subtítulos más discretos — Tipo B |
| `cambio_de_template` | Cambio de template (futuro) | Solo tiene sentido cuando exista un segundo template — hoy se guarda la intención igual, sin acción automática |
| `correccion_de_texto` | Corrección de texto | Ajuste puntual de caption/hashtags sin re-renderizar el video — el más liviano de los seis |

**Lo que esta capa deja listo sin construir el motor completo:** el contrato (`variant_type` + `comment` en `review_actions`, `raw_videos.status='variant_requested'`) es exactamente lo que el motor de variantes de Capa 9 va a leer para decidir qué generar. No hace falta ningún cambio de esquema cuando se construya — solo agregar el workflow que lea `raw_videos` en `variant_requested`, junto con el último `review_actions.variant_type`/`comment` de ese video, y dispare el prompt correspondiente (reutilizando el patrón Tipo A/Tipo B ya definido en `sistema-fabrica-reels-nexoia.md`, sección 13).

---

## 7. Integración con publicación

Al aprobar, `createPublicationJob()` inserta directo en `publications` (la tabla ya definida para Capa 6, ver nota de la sección 2):

```json
{
  "render_id": "b7e2f1a0-...",
  "raw_video_id": "9b2f1e3a-...",
  "client_id": "3fa85f64-...",
  "platform": "instagram_reels",
  "caption_used": "Esto cambió mi forma de vender...",
  "hashtags_used": "#pymes #automatizacion #ia ...",
  "status": "queued"
}
```

**Plataforma destino:** se toma directo de `edit_spec.platform` (hoy siempre `instagram_reels`, ver limitación conocida en `capa3-edit-director-n8n.md`). **Limitación documentada, no resuelta acá:** como el render ya se hizo con los safe-areas de una sola plataforma, "aprobar para ambas" no es todavía una opción real — el mismo MP4 no está optimizado para las dos a la vez. Soporte real de multi-plataforma llega cuando Capa 3 genere un `edit_spec` (y por lo tanto un render) por plataforma, no antes. **Caption y hashtags:** se toman de `assets.captions_ig`/`captions_tiktok` (el primero de la lista de 3 generados en Capa 2) y `assets.hashtags`, ya generados — Capa 5 no genera texto nuevo, solo lo empaqueta.

---

## 8. Manejo de errores

| Caso | Dónde se detecta | Qué pasa |
|---|---|---|
| Callback duplicado | Guard de `raw_videos.status !== 'rendered_pending_review'` antes de procesar | Responde "ya fue procesado", no vuelve a escribir |
| Video ya aprobado / ya rechazado | Mismo guard de arriba | Idem |
| Usuario sin permiso | `checkPermissionByRender`/`checkPermissionByRawVideo` contra `reviewers` | "🚫 No tenés permiso", nada se escribe en Supabase |
| Link expirado | No detectable en servidor | Botón "🔗 Regenerar link" → `POST /renders/:id/refresh-link` |
| Render no encontrado | `checkPermissionByRender` no encuentra la fila | "⚠️ No encontré este render", nada se escribe |
| Supabase caído | `try/catch` general envolviendo todo el dispatcher | No crashea la ejecución; cada update de Telegram es una ejecución independiente de n8n, así que un fallo no bloquea al resto |
| Telegram callback vencido | `safeAnswerCallback` envuelto en `try/catch`, ignora el error | La decisión se guarda en Supabase igual — solo falla el "toast" visual de Telegram, no la lógica |
| Comentario pendiente que nunca llega | Sweep "1. Sweep sesiones de comentario vencidas", cada 1 min, `expires_at < now()` (30 min) | Auto-finaliza con comentario placeholder, nunca deja un video colgado indefinidamente |

---

## 9. Documentación de prueba

### Diagrama de estados

Ver sección 1.

### Payloads de Telegram — ejemplos reales

**`callback_query` al apretar "✅ Aprobar":**
```json
{
  "update_id": 123456789,
  "callback_query": {
    "id": "9988776655",
    "from": { "id": 555111222, "username": "evelin_hh", "first_name": "Evelin" },
    "message": { "message_id": 4821, "chat": { "id": -1001234567890 }, "text": "🎬 Video listo para revisar..." },
    "data": "appr:b7e2f1a0-1234-4abc-9def-abcdef123456"
  }
}
```

**`message` con el comentario de un rechazo:**
```json
{
  "update_id": 123456790,
  "message": {
    "message_id": 4823,
    "chat": { "id": -1001234567890 },
    "from": { "id": 555111222, "username": "evelin_hh" },
    "text": "el hook queda flojo, no engancha en el segundo 1"
  }
}
```

### Comandos de prueba

```bash
# 1. Insertar un reviewer de prueba (usar tu propio telegram_user_id -- se
#    obtiene mandándole cualquier mensaje a @userinfobot en Telegram)
curl -X POST "$SUPABASE_URL/rest/v1/reviewers" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"client_id":"<client_id>","telegram_user_id":"555111222","telegram_username":"evelin_hh","active":true}'

# 2. Forzar un raw_video a rendered_pending_review (si ya tenés uno real del ciclo Capa 3+4, usar ese)
curl -X PATCH "$SUPABASE_URL/rest/v1/raw_videos?id=eq.<raw_video_id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"rendered_pending_review","review_prompt_sent_at":null}'

# 3. Esperar hasta 1 minuto -- debería llegar el mensaje de Telegram con los 7 botones.

# 4. Probar el endpoint de regenerar link directo (sin pasar por Telegram)
curl -X POST http://localhost:3001/renders/<render_id>/refresh-link
```

### Checklist de QA — Capa 5 lista cuando:

- [ ] Un `reviewer` sin permiso (no dado de alta en la tabla) que aprieta cualquier botón recibe "🚫 No tenés permiso" y no cambia nada en Supabase.
- [ ] "✅ Aprobar" deja `raw_videos.status='approved_for_publish'`, crea una fila en `review_actions` y una fila en `publications` con `status='queued'`.
- [ ] "❌ Rechazar" pide el comentario, y al responder deja `raw_videos.status='rejected'` con el comentario guardado en `review_actions.comment`.
- [ ] "🔁 Variante automática" pide primero el tipo (6 botones) y después el comentario; el resultado final tiene `variant_type` Y `comment` guardados.
- [ ] "🚩 Marcar como error" rechaza un intento de escribir "skip" como comentario (mensaje pidiendo que sí describa el error) y solo finaliza con texto real.
- [ ] Clickear el mismo botón dos veces seguidas (o dos personas aprobando el mismo video casi al mismo tiempo) resulta en una sola decisión final — la segunda recibe "ya fue procesado".
- [ ] Abrir una sesión de comentario y no responder nada: a los 30 minutos el sweep la cierra sola, `raw_videos.status` queda en el valor correspondiente, y `review_actions.comment` dice que expiró.
- [ ] "🔗 Regenerar link" manda una URL nueva y funcional sin volver a renderizar (verificar `renders.updated_at` cambia, `renders.status` sigue `done`).
- [ ] "🎥 Volver a renderizar" deja `raw_videos.status='edit_spec_ready'` y el ciclo de Capa 4 lo vuelve a renderizar solo, sin tocar Supabase a mano.
- [ ] El botón "🔁 Reintentar" de un mensaje de FALLO de Capa 4 (`retr:`) sigue funcionando igual que antes, ahora procesado por Capa 5.
- [ ] Con la v2 de Capa 4 (sin nodos de revisión) y Capa 5 activos al mismo tiempo, cada `callback_query` se procesa una sola vez (no hay dos Telegram Trigger escuchando el mismo bot).

### Ejemplos reales

**Aprobación:** click en ✅ → `review_actions` nueva fila `{decision:"approved", comment:null}` → `raw_videos.status="approved_for_publish"` → `publications` nueva fila `{status:"queued", platform:"instagram_reels", caption_used:"..."}` → mensaje editado a "✅ Aprobado por telegram:@evelin_hh".

**Rechazo:** click en ❌ → mensaje nuevo "✍️ Contame el motivo..." → responde "el hook queda flojo, no engancha en el segundo 1" → `review_actions` nueva fila `{decision:"rejected", comment:"el hook queda flojo..."}` → `raw_videos.status="rejected"` → confirmación "❌ Rechazado -- registrado. Comentario: \"el hook queda flojo...\"".

**Pedido de variante:** click en 🔁 → menú de 6 tipos → elige "Subtítulos más agresivos" → mensaje "✍️ Contame en una frase..." → responde "skip" → `review_actions` nueva fila `{decision:"variant_requested", variant_type:"subtitulos_agresivos", comment:null}` → `raw_videos.status="variant_requested"`.
