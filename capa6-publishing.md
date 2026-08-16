# Capa 6: publicación real en TikTok e Instagram

**Objetivo:** cuando un video queda en `approved_for_publish` (Capa 5 ya insertó la fila en `publications`), publicarlo en la plataforma destino a través de un proveedor intermedio, guardar el ID externo, actualizar el estado y avisar.

**Criterio de éxito:** un video aprobado desde Telegram genera una publicación real (o simulada, con el proveedor mock) en TikTok/Instagram, guarda el ID externo en Supabase, actualiza estado y avisa al usuario — sin intervención manual.

**Código real:**
- Workflow importable: [`fabrica-reels/n8n/capa6-publishing.workflow.json`](./fabrica-reels/n8n/capa6-publishing.workflow.json)
- Nodos Code: [`fabrica-reels/n8n/code-nodes/capa6-*.js`](./fabrica-reels/n8n/code-nodes)
- Servicio de publicación: [`fabrica-reels/services/publish-api/`](./fabrica-reels/services/publish-api) (contrato + adapters)
- Migración SQL: [`fabrica-reels/schema/capa6-publishing.migration.sql`](./fabrica-reels/schema/capa6-publishing.migration.sql)

---

## 1. Decisión técnica de publicación

| | API oficial directa (Meta Graph API + TikTok Content Posting API) | Metricool / Publer / Buffer | **Upload-Post** (recomendado) |
|---|---|---|---|
| Onboarding de cuenta de cliente | Cada cliente necesita su app revisada por Meta/TikTok, o vos operás una sola app y cada cliente pasa por tu flujo OAuth (posible, pero mantenerlo es trabajo real) | Dashboard-first: el cliente conecta su cuenta desde SU panel, pensado para que un humano use la interfaz, no para automatizar en nombre de muchos clientes | API-first: un link OAuth hospedado por el proveedor, el cliente conecta una vez, vos recibís un identificador de perfil — pensado exactamente para esto |
| TikTok en particular | El **Content Posting API** de TikTok sin auditoría de tu app solo permite publicar como borrador/privado (`SELF_ONLY`) — conseguir el scope de publicación directa implica un proceso de revisión de TikTok que puede tardar semanas y rechazarse | Idem — cada proveedor ya pasó (o no) su propia auditoría con TikTok, pero el nivel de acceso real varía y no siempre es mejor que hacerlo vos mismo | Ya tiene el acceso auditado del lado de TikTok — es la ventaja más concreta de usar un intermediario para TikTok específicamente |
| Mantenimiento de tokens | Vos administrás refresh tokens de cada cuenta de cada cliente — superficie de seguridad y de mantenimiento real | El proveedor lo administra, pero necesitás su token de API para SU sistema | El proveedor administra los tokens de IG/TikTok; vos nunca los ves — solo guardás un identificador de perfil que ELLOS asignan |
| Costo | \$0 de licencia, pero cuesta tiempo de desarrollo/mantenimiento | Plan mensual pensado para agencias de contenido humano (funciones que no usás: calendario visual, aprobaciones de cliente por dashboard) | Plan mensual pensado para volumen de API, más barato a este uso |
| Ajuste al caso de uso | Máximo control, pero la complejidad no se justifica todavía con 1 cliente | No fue diseñado para "una IA publica en nombre de muchos clientes sin dashboard" | Diseñado exactamente para esto |

**Recomendación (mantiene la de la arquitectura original, `sistema-fabrica-reels-nexoia.md` sección 8):** **Upload-Post** para el adapter real de Capa 6. Metricool/Publer/Buffer son mejores herramientas cuando hay un humano mirando un calendario y aprobando visualmente — acá el "aprobar" ya pasó en Capa 5, lo que queda es una llamada API pura, y para eso un proveedor API-first encaja mejor.

**Interfaz interna desacoplada del proveedor:** `fabrica-reels/services/publish-api/src/types.ts` define `PublishJob` / `PublishResult` / `PublishProvider` — n8n y Supabase nunca ven la forma específica de Upload-Post. Cambiar de proveedor (a Metricool, a la API oficial cuando se justifique, a lo que sea) es escribir un archivo nuevo en `providers/` que implemente `PublishProvider` y sumarlo a `providerRegistry.ts` — nada del workflow ni del modelo de datos cambia. El `provider` a usar se decide por `social_accounts.publisher_provider` (por cliente+plataforma), no está hardcodeado.

---

## 2. Modelo de datos

`publications` ya existía (arquitectura original, poblada por Capa 5 al aprobar). Columnas agregadas por esta migración:

| Columna | Para qué |
|---|---|
| `provider` | qué adapter usar (`mock`, `upload_post`, ...) — copiado de `social_accounts.publisher_provider` al preparar la publicación |
| `provider_status` | texto crudo devuelto por el proveedor, para debugging |
| `error_message` | último error, si lo hay |
| `retry_count` | cuántos intentos ya se hicieron |
| `next_attempt_at` | cuándo reintentar (backoff), si el último intento falló de forma transitoria |
| `account_id` | FK a `social_accounts` — qué cuenta conectada se usó |
| `locked_at` / `locked_by` | candado de idempotencia (sección 9) |
| `updated_at` | timestamp de última modificación |

**Nota de continuidad:** no se agregó `provider_post_id` — `external_post_id` (columna original) ya cumple exactamente ese propósito. Tampoco se creó ninguna tabla nueva de "cuentas" — `social_accounts` ya existía con `client_id`, `platform`, `publisher_provider`, `external_account_id`, `oauth_token_ref`, `status`.

**Plataformas — "ambas":** el modelo de datos ya soporta esto de forma nativa: cada fila de `publications` es una plataforma. El único límite hoy es que Capa 5 crea automáticamente **una sola fila** por aprobación, porque `edit_spec.platform` es singular (el render ya está optimizado para safe-areas de una sola plataforma — ver limitación documentada en `capa3-edit-director-n8n.md`). "Publicar en ambas" con el render de hoy es posible insertando manualmente una segunda fila de `publications` reutilizando el mismo `render_id` con `platform` distinto; Capa 6 la procesa sin cambios. La generación automática de las dos filas llega cuando Capa 3 genere `edit_specs` (y por lo tanto renders) por plataforma.

---

## 3. Workflow n8n Capa 6

```
Trigger "Cada 5 min"
  ├─► 0. Preparar publicaciones queued          [Code, runOnceForAllItems]
  ├─► 1. Detectar publicaciones listas          [Code, runOnceForAllItems]
  │     → Procesar de a una                      [Loop Over Items]
  │         → 2. Publicar (con lock)              [Code, runOnceForEachItem]
  │         → (vuelve a "Procesar de a una")
  └─► 3. Sweep locks vencidos                    [Code, runOnceForAllItems]
```

Solo 6 nodos — mismo criterio de las capas anteriores: cada Code node hace sus propias llamadas (Supabase + `publish-api` + Telegram vía HTTP directo).

- **0. Preparar publicaciones queued:** toma lo que Capa 5 dejó en `status='queued'`, arma el caption final (`caption_used` + `hashtags_used`, truncado a 2200 caracteres), valida que haya una cuenta activa conectada, calcula `scheduled_at` respetando timezone del cliente y el espaciado mínimo entre publicaciones (sección 7), y deja `status='ready_to_schedule'`.
- **1. Detectar publicaciones listas:** `status='ready_to_schedule'`, `scheduled_at` ya llegó, sin lock activo, y si es un reintento, `next_attempt_at` ya pasó.
- **2. Publicar (con lock):** reclama el candado, llama a `publish-api`, guarda el resultado, decide si reintenta o queda terminal, avisa por Telegram.
- **3. Sweep locks vencidos:** libera candados de más de 10 minutos (mismo principio que los sweeps de Capa 4 y 5).

---

## 4. Contrato de publicación interno

Archivo: [`fabrica-reels/services/publish-api/src/types.ts`](./fabrica-reels/services/publish-api/src/types.ts)

```ts
export interface PublishJob {
  publication_id: string;
  client_id: string;
  platform: "tiktok" | "instagram_reels";
  provider: string;
  account_external_id: string; // identificador de la cuenta YA conectada del lado del proveedor
  video_url: string;           // renders.public_url
  caption: string;             // ya con hashtags incluidos
  scheduled_at: string | null; // ISO 8601 UTC; null = publicar ya
}

export type PublishStatus = "published" | "scheduled" | "failed" | "rate_limited" | "pending";

export interface PublishResult {
  ok: boolean;
  status: PublishStatus;
  provider_post_id: string | null;
  provider_status: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  error_message: string | null;
  retryable: boolean;
}

export interface PublishProvider {
  name: string;
  publish(job: PublishJob): Promise<PublishResult>;
  checkStatus?(providerPostId: string, platform: Platform): Promise<PublishResult>;
}
```

**Cómo mapea cada proveedor:** el adapter (`providers/uploadPostProvider.ts`, `providers/mockProvider.ts`) es el ÚNICO lugar que conoce el shape específico del proveedor externo — recibe un `PublishJob`, hace lo que tenga que hacer (llamar la API, subir el archivo, lo que sea), y devuelve siempre un `PublishResult` con la forma de arriba. `providerRegistry.ts` elige el adapter por nombre (`job.provider`).

---

## 5. Estrategia para Instagram (Reels)

- **Requisitos de cuenta:** cuenta de Instagram **Business** o **Creator**, conectada al proveedor (Upload-Post gestiona el link a la Facebook Page requerida por Meta de su lado — no es algo que nosotros manejemos).
- **Captions y hashtags:** Instagram no tiene un campo separado de hashtags — van dentro del texto del caption. `caption_used` final = `assets.captions_ig[0]` + salto de línea + `assets.hashtags_used`, límite 2200 caracteres (mismo límite que impone la plataforma).
- **Link al video:** se descarga desde `renders.public_url` (URL firmada de Supabase Storage) y se sube al proveedor — nunca se asume que Instagram/el proveedor van a poder acceder directo a una URL firmada de duración limitada sin que nosotros la bajemos primero.
- **Limitaciones esperadas:** duración máxima de Reels ~90s (ya lo impone `duration.target_sec` desde Capa 3, consistente); aspect ratio 9:16 (ya lo impone el schema); si la cuenta no es Business/Creator, la API de Instagram simplemente no expone el permiso de publicación — se manifiesta como un error 401/403 del proveedor (sección 8).

---

## 6. Estrategia para TikTok

- **Publicación directa vs. borrador:** con una app SIN auditar por TikTok, el Content Posting API solo permite `SELF_ONLY` (el video queda como borrador visible solo para el dueño de la cuenta, que tiene que entrar a la app de TikTok y publicarlo a mano). Usar un proveedor ya auditado (Upload-Post) es la forma práctica de tener publicación directa real sin pasar por ese proceso nosotros mismos.
- **Requisitos de cuenta:** cuenta de TikTok conectada vía el flujo OAuth del proveedor — no hace falta que sea una cuenta "Business" de TikTok específicamente (a diferencia de Instagram), pero si el proveedor lo requiere para ciertas funciones, queda documentado del lado de ellos.
- **Captions y hashtags:** mismo criterio que Instagram — todo en el campo de texto, límite similar (~2200 caracteres, aunque la UI de TikTok trunca la vista en menos).
- **Limitaciones esperadas:** si la cuenta del cliente nunca completó el flujo de conexión con el proveedor (o lo revocó), la publicación falla con un error de permisos claro — se distingue en el manejo de errores (sección 8) de un fallo transitorio.

---

## 7. Programación

- **Publicar inmediatamente:** si Capa 5 no impone lo contrario, `scheduled_at` se calcula igual (no hay un modo "ya mismo" que salte la cola) — pero como el schedule trigger corre cada 5 minutos, el efecto práctico es "casi inmediato" salvo que el horario calculado sea a futuro.
- **Mejor horario:** sin datos de métricas todavía (eso es Capa 7-8, fuera de alcance de esta etapa a propósito), se usa un horario por defecto configurable por cliente: `clients.default_publish_hour_local` (hora local, default 10 AM). Cuando existan métricas, ese valor se puede sobreescribir con el horario histórico real — el cálculo de `scheduled_at` no cambia, solo de dónde sale la hora.
- **Evitar publicar dos videos muy juntos:** `clients.min_hours_between_posts` (default 4h) — antes de fijar `scheduled_at`, se consulta la última publicación `scheduled`/`published` del mismo cliente+plataforma y se empuja el horario si queda demasiado cerca.
- **Timezone `America/Santiago`:** todos los cálculos de "qué hora es" usan `Intl.DateTimeFormat` con `timeZone: client.timezone` (default `America/Santiago`) en vez de un offset fijo, para no romperse con el cambio de horario de verano. Limitación conocida documentada en el código: en el día exacto de la transición de DST el cálculo puede correrse en 1 hora — aceptable para una heurística de "mejor horario", no crítico.
- **Calendario semanal:** no se construyó una UI — es una query directa: `publications?scheduled_at=gte.<hoy>&scheduled_at=lte.<hoy+7d>&client_id=eq.<cliente>&order=scheduled_at.asc`. El portal (Capa 11) la usaría tal cual para pintar un calendario.

---

## 8. Manejo de errores

| Caso | Dónde se detecta | Qué pasa |
|---|---|---|
| Proveedor caído | `try/catch` alrededor de la llamada a `publish-api` en el nodo "2. Publicar" | tratado como transitorio, reintento con backoff |
| Token vencido | `uploadPostProvider` detecta HTTP 401/403 | `retryable:false` → `status='failed'` directo, requiere reconectar la cuenta manualmente (no se reintenta solo) |
| Video no accesible | Falla la descarga de `video_url` dentro del adapter | `retryable:true` (posible link vencido, reintentable — si sigue fallando tras 3 intentos, revisar manualmente con el botón de Capa 5 "Regenerar link" antes de reintentar) |
| Video demasiado pesado | Ya mitigado en Capa 4 (`MAX_RENDER_SIZE_MB`, típicamente 100MB) — muy por debajo de los límites de TikTok/Instagram | no debería ocurrir; si el proveedor igual lo rechaza por tamaño, cae en "fallo terminal del proveedor" |
| Caption inválido | Validado en "0. Preparar publicaciones" (vacío → falla ahí mismo; muy largo → se trunca a 2200) | `status='failed'` si está vacío; truncado silencioso si es muy largo |
| Plataforma no conectada | "0. Preparar publicaciones" no encuentra `social_accounts` activa | `status='failed'`, mensaje explícito, no se reintenta solo |
| Publicación duplicada | Lock (`locked_at`/`locked_by`) + chequeo de `external_post_id` ya seteado antes de llamar al proveedor + índice único `(render_id, platform)` para filas no-`failed` | nunca se llama al proveedor dos veces para la misma fila |
| Fallo parcial (TikTok sí, IG no) | Cada plataforma es una fila independiente de `publications` | se ve directo en la tabla — una fila `published`, otra `failed`, sin necesidad de un estado especial |
| Rate limits | `uploadPostProvider` detecta HTTP 429 | `retryable:true`, backoff exponencial (3, 9, 27 minutos) |
| Reintentos seguros | `retry_count` + `next_attempt_at`, máximo 3 intentos (mismo patrón que Capa 3/4) | al agotarse, `status='failed'` + alerta Telegram con el error |

---

## 9. Seguridad e idempotencia

- **No publicar dos veces el mismo render:** antes de llamar al proveedor, se relee la fila y se aborta si `external_post_id` ya tiene valor (puede pasar si el lock se reclamó pero una ejecución anterior ya había llegado a publicar antes de morir a mitad de camino).
- **Locking por publicación:** `PATCH ...&locked_at=is.null` — el `WHERE` condicional hace que solo UNA ejecución concurrente reciba la fila actualizada en la respuesta; si la respuesta viene vacía, otra ejecución ya la tomó y esta se aborta sin tocar nada más.
- **Logs de intentos:** `retry_count`, `error_message` y `provider_status` quedan en la propia fila de `publications` (última información conocida) — no se modeló un log fila-por-fila de cada intento por separado, simplificación consciente dado el volumen actual; se puede agregar una tabla `publish_attempts` después sin romper nada si hace falta auditoría más fina.
- **Separación multi-cliente:** cada `publications` tiene `client_id`; `social_accounts` idem; el `account_external_id` que se le pasa al proveedor es específico de la cuenta conectada de ESE cliente — no hay forma de que un job de un cliente termine publicando en la cuenta de otro.
- **Tokens por cliente/cuenta:** con Upload-Post como proveedor, **nunca guardamos el token de Instagram/TikTok del cliente** — el cliente lo conecta directo con Upload-Post (su OAuth, sus tokens, su refresh), y nosotros solo guardamos el identificador de perfil que Upload-Post asigna (`social_accounts.external_account_id`). `oauth_token_ref` queda sin uso real para este proveedor específico — es la columna que se usaría si algún día se implementa un `DirectMetaProvider`/`DirectTikTokProvider` que sí maneje tokens propios, y en ese caso apuntaría a un secreto en un vault, nunca al token en texto plano en la tabla.

---

## 10. Documentación de prueba

### Diagrama de estados

```
queued  (Capa 5 lo crea al aprobar)
   │
   ▼
ready_to_schedule  (caption validado, scheduled_at calculado, cuenta confirmada)
   │  (scheduled_at llega, sin lock)
   ▼
publishing  (lock tomado, llamando al proveedor)
   │
   ├─► published   (provider_post_id + published_at)
   ├─► scheduled   (el proveedor lo programó del lado suyo)
   └─► [fallo] ─┬─ retryable  → vuelve a ready_to_schedule con next_attempt_at (hasta 3 veces)
                └─ terminal   → failed
```

### Variables de entorno

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | igual que capas anteriores |
| `PUBLISH_API_URL` | ej. `http://localhost:3003` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alertas |
| `UPLOAD_POST_API_KEY` | solo si `provider='upload_post'` |
| `UPLOAD_POST_API_URL` | opcional, default `https://api.upload-post.com/api` |

### Setup del proveedor recomendado (Upload-Post)

1. Crear cuenta en Upload-Post, obtener el API key de agencia (`UPLOAD_POST_API_KEY`) — **uno solo, no por cliente**.
2. Por cada cliente: generar el link de conexión hospedado por Upload-Post (desde su dashboard o su API de "crear perfil"), el cliente conecta ahí su Instagram/TikTok.
3. Guardar el identificador de perfil que Upload-Post devuelve en `social_accounts.external_account_id`, con `publisher_provider='upload_post'`, `status='active'`.

### Cómo probar con el proveedor mock (sin publicar de verdad)

```bash
cd fabrica-reels/services/publish-api
npm install
npm start   # :3003

curl -X POST http://localhost:3003/publish \
  -H "Content-Type: application/json" \
  -d '{
    "publication_id": "test-1",
    "client_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "platform": "instagram_reels",
    "provider": "mock",
    "account_external_id": "mock-account",
    "video_url": "https://example.com/video.mp4",
    "caption": "Probando la Fábrica de Reels",
    "scheduled_at": null
  }'
# → {"ok":true,"status":"published","provider_post_id":"mock_instagram_reels_...", ...}
```

### Comandos de prueba end-to-end

```bash
# 1. Dar de alta una cuenta con el proveedor mock (para no publicar de verdad)
curl -X POST "$SUPABASE_URL/rest/v1/social_accounts" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"client_id":"<client_id>","platform":"instagram_reels","publisher_provider":"mock","external_account_id":"mock-account","status":"active"}'

# 2. Forzar una publications a queued (si ya tenés una real de Capa 5, usar esa)
curl -X PATCH "$SUPABASE_URL/rest/v1/publications?id=eq.<publication_id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"queued"}'

# 3. Esperar hasta 10 minutos (dos ciclos del schedule trigger) -- debería
#    quedar 'published' con external_post_id seteado, y llegar la alerta
#    de Telegram.
```

### Checklist de QA — Capa 6 lista cuando:

- [ ] Con `provider='mock'`, una `publications` en `queued` termina en `published` con `external_post_id` seteado, sin llamar a ningún servicio externo real.
- [ ] Un caption con `"FORZAR_FALLO"` (mock) deja la fila en `failed` en el primer intento (no retryable).
- [ ] Un caption con `"FORZAR_RATE_LIMIT"` (mock) reintenta hasta 3 veces con backoff creciente, y al agotarse queda `failed` con el mensaje de error guardado.
- [ ] Sin ninguna `social_accounts` activa para el cliente+plataforma, la fila queda `failed` con el mensaje "no hay cuenta activa" sin siquiera llegar a "2. Publicar".
- [ ] Dos ejecuciones del schedule trigger solapadas (forzar corriendo el workflow dos veces manualmente casi al mismo tiempo) resultan en una sola publicación real — la segunda ejecución recibe `skipped_already_locked`.
- [ ] Matar el proceso de `publish-api` a mitad de un intento simulado, y verificar que el sweep de locks libera la fila en menos de 12 minutos.
- [ ] `scheduled_at` calculado respeta el horario configurado en `clients.default_publish_hour_local` en la timezone del cliente, y respeta `min_hours_between_posts` contra la última publicación del mismo cliente+plataforma.
- [ ] Un video aprobado desde Telegram (Capa 5) llega, sin tocar nada a mano, hasta `published` en `publications`, con la alerta final de Telegram.

### Ejemplo real de éxito

```json
{
  "ok": true,
  "status": "published",
  "provider_post_id": "mock_instagram_reels_1755302400000",
  "provider_status": "MOCK_PUBLISHED",
  "published_at": "2026-08-16T14:00:00.000Z",
  "scheduled_at": null,
  "error_message": null,
  "retryable": false
}
```

### Ejemplo real de error manejado

```json
{
  "ok": false,
  "status": "failed",
  "provider_post_id": null,
  "provider_status": "HTTP_401",
  "published_at": null,
  "scheduled_at": null,
  "error_message": "Token/cuenta de Upload-Post vencido o sin permisos para esta cuenta -- requiere reconectar",
  "retryable": false
}
```

---

## 11. Entregables

- [x] Workflow n8n: [`fabrica-reels/n8n/capa6-publishing.workflow.json`](./fabrica-reels/n8n/capa6-publishing.workflow.json)
- [x] Migración SQL: [`fabrica-reels/schema/capa6-publishing.migration.sql`](./fabrica-reels/schema/capa6-publishing.migration.sql)
- [x] Contrato `PublishJob`/`PublishResult`/`PublishProvider`: [`fabrica-reels/services/publish-api/src/types.ts`](./fabrica-reels/services/publish-api/src/types.ts)
- [x] Adapter Upload-Post: [`fabrica-reels/services/publish-api/src/providers/uploadPostProvider.ts`](./fabrica-reels/services/publish-api/src/providers/uploadPostProvider.ts) (⚠️ verificar el shape exacto de su API vigente antes de producción, ver comentario en el archivo)
- [x] Mock provider: [`fabrica-reels/services/publish-api/src/providers/mockProvider.ts`](./fabrica-reels/services/publish-api/src/providers/mockProvider.ts)
- [x] Este documento

**Nota de calidad:** todo el código TypeScript nuevo (`publish-api`) y el código TypeScript existente que esta capa toca indirectamente (`schema/`, `validation/`, `remotion/`) pasa `tsc --noEmit` sin errores — al armar esta capa se encontró y corrigió un bug real de continuidad de dos capas atrás: `schema/` y `validation/` son carpetas compartidas por varios paquetes hoja, pero `zod` solo estaba instalado en el `node_modules` de cada paquete hoja, no en un lugar que la resolución de módulos de Node pudiera encontrar desde esas carpetas compartidas. Se agregó `fabrica-reels/package.json` (con `zod` como dependencia) para darles un `node_modules` ancestro común.
