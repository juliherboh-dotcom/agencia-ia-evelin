# Capa 7-8: métricas y scoring — el loop de aprendizaje

**Objetivo:** cuando una publicación queda en `published`, recolectar métricas a 24h/48h/72h/7d, compararlas contra el benchmark de la cuenta/plataforma, calcular un score 0-100, y marcar ganadores automáticamente para alimentar Capa 9 (motor de variantes).

**Criterio de éxito:** una publicación real o mock en `published` genera snapshots en las 4 ventanas, calcula score, actualiza benchmark y marca ganadores automáticamente.

**Código real:**
- Workflows: [`fabrica-reels/n8n/capa7-metrics.workflow.json`](./fabrica-reels/n8n/capa7-metrics.workflow.json), [`fabrica-reels/n8n/capa8-scoring.workflow.json`](./fabrica-reels/n8n/capa8-scoring.workflow.json)
- Servicio: [`fabrica-reels/services/metrics-api/`](./fabrica-reels/services/metrics-api) (contrato + providers + `calculatePerformanceScore()`)
- Migración SQL: [`fabrica-reels/schema/capa7-8-metrics-scoring.migration.sql`](./fabrica-reels/schema/capa7-8-metrics-scoring.migration.sql)

Se separaron en **dos workflows independientes** (Capa 7 recolecta, Capa 8 calcula), mismo criterio que toda la Fábrica de Reels: cada uno detecta su propia condición de entrada por polling, no se encadenan por webhook — así Capa 8 puede reprocesar snapshots viejos si se reinicia sin depender de que Capa 7 "le avise".

---

## Diagrama del loop de aprendizaje

```
publications.status = 'published'
        │
        ▼
┌───────────────────────────────────────────┐
│ CAPA 7 (cada 30 min)                       │
│ ¿ya pasaron 24h/48h/72h/7d desde            │
│ published_at y todavía no hay snapshot      │
│ para esa ventana?                           │
│   → metrics-api → post_metrics (INSERT)     │
└───────────────────┬─────────────────────────┘
                     ▼
┌───────────────────────────────────────────┐
│ CAPA 8 (cada 15 min)                       │
│ ¿hay un post_metrics sin score todavía?     │
│   1. recalcular account_benchmarks          │
│      (cliente+plataforma+ventana)           │
│   2. calculatePerformanceScore()            │
│   3. guardar en `scores`                    │
│   4. score≥70 y todavía no era ganador?      │
│      → raw_videos.variant_generation_status  │
│        = 'ready'  +  alerta Telegram         │
│   5. ¿2+ plataformas para el mismo video?    │
│      → score consolidado                     │
└───────────────────┬─────────────────────────┘
                     ▼
        raw_videos.variant_generation_status = 'ready'
                     │
                     ▼
              (Capa 9, no construida todavía --
               lee esta cola y genera variantes)
```

---

## 1. Modelo de datos de métricas — `post_metrics`

**Nota de continuidad:** no se creó una tabla nueva — la tabla `metrics` ya existía desde la arquitectura original (`sistema-fabrica-reels-nexoia.md`, sección 9). Se renombró a `post_metrics` (que es exactamente lo pedido) y se le agregaron las columnas que faltaban.

| Columna | Origen | Notas |
|---|---|---|
| `publication_id`, `window`→`snapshot_window`, `measured_at`→`snapshot_at`, `views`, `likes`, `comments`, `shares`, `saves`, `retention_avg`→`retention_rate`, `source` | ya existían | 3 renombres para alinear nombres |
| `client_id`, `raw_video_id`, `render_id`, `account_id` | nuevas | para no tener que hacer join hasta `publications` cada vez que se quiere filtrar por cliente |
| `platform` | nueva | copiado de `publications.platform` en el snapshot, para poder comparar por plataforma sin join |
| `follows`, `profile_visits`, `completion_rate`, `engagement_rate` | nuevas | `engagement_rate` se calcula una sola vez al guardar: `(likes+comments+shares+saves)/views` |
| `raw_payload` | nueva | JSON crudo del provider, para debug sin tener que volver a llamarlo |
| `confidence_level` | nueva | `'high'` / `'medium'` / `'low'` — baja automáticamente si los datos parecen implausibles (sección 8) |

Índice único `(publication_id, snapshot_window)` — nunca dos snapshots para la misma ventana de la misma publicación (idempotencia a nivel de base de datos, además del chequeo que hace el propio workflow).

---

## 2. Modelo de benchmark — `account_benchmarks`

**Nota de continuidad:** tampoco se creó una tabla nueva — `benchmarks` ya existía. Se renombró y se le agregó la dimensión que le faltaba: la tabla original solo tenía `client_id` + `period` (un promedio general de la cuenta); Capa 8 necesita comparar "TikTok a 24h contra TikTok a 24h", no contra un promedio mezclado de todo. Se reemplazó `period` por `platform` + `window`.

| Columna | Para qué |
|---|---|
| `client_id`, `platform`, `window` | clave natural (índice único) |
| `avg_views`, `avg_likes`, `avg_comments`, `avg_shares`, `avg_saves`, `avg_follows`, `avg_profile_visits`, `avg_engagement_rate`, `avg_retention_rate`, `avg_completion_rate` | promedios rolling (últimas 50 muestras, excluyendo la publicación que se está evaluando) |
| `sample_count` | cuántas muestras entraron en el promedio actual |
| `min_samples_required` | default 5 — por debajo de esto, el score usa el benchmark genérico de fallback (sección 3) en vez del propio |

Se recalcula en cada corrida de Capa 8, no en un job aparte — es barato (una query + un promedio en JS) y garantiza que el benchmark siempre refleja los datos más recientes antes de puntuar el siguiente snapshot.

---

## 3. Score de rendimiento 0-100

Archivo: [`fabrica-reels/services/metrics-api/src/scoring.ts`](./fabrica-reels/services/metrics-api/src/scoring.ts) — función pura `calculatePerformanceScore()`, sin red ni Supabase, fácil de testear con números fijos (todos los ejemplos de abajo son la salida REAL de correr esta función, no números inventados a mano).

### Fórmula

```
índice(métrica) = min(valor_propio / benchmark_de_la_cuenta / 2, 1)
```
Es decir: estar exactamente en el promedio de la cuenta da índice 0.5; el doble del promedio (o más) satura el índice en 1. Una consecuencia linda de esto: un post "exactamente promedio" en todo saca ~50/100 — cae justo en el medio de la banda "normal", que es la intención.

**Pesos base** (suman 100):

| Métrica | Peso |
|---|---|
| views | 25 |
| shares | 20 |
| saves | 20 |
| comments | 10 |
| follows | 10 |
| engagement_rate | 10 |
| retention | 5 |

**Redistribución cuando falta una métrica** (generaliza la regla de la arquitectura original, que solo cubría retención): el peso de cualquier métrica no disponible (típicamente `saves`/`retention` en TikTok) se reparte proporcionalmente entre las que sí están disponibles, no se pierde ni se cuenta como 0.

**Penalización de retención (piso absoluto, no relativo):** si `retention_rate < 15%`, se restan 10 puntos extra — independiente de cómo venga el benchmark. Un 8% de retención es malo aunque el promedio histórico de la cuenta también sea bajo; por eso este chequeo no se normaliza contra el benchmark como el resto.

**Bonus viral:** si `shares`, `saves` y `follows` están al menos 2 de los 3 en el tope de su índice (2x+ el benchmark) al mismo tiempo, se suman 10 puntos — es la señal de que el video se está compartiendo de verdad, no solo viéndose.

**Cuentas con pocos datos:** si `account_benchmarks.sample_count < min_samples_required` (5), se usa un benchmark genérico de arranque (`avg_views=500`, `avg_engagement_rate=5%`, etc. — números de referencia razonables, no una medición real) en vez del propio de la cuenta, y el resultado queda marcado `benchmark_confidence='fallback_generic'` en vez de `'account'` — así un reporte puede mostrar "ganador, pero con poca confianza" en vez de tratarlo igual que un ganador medido contra 50 posts reales.

### Clasificación

| Score | Clasificación |
|---|---|
| 0-39 | malo |
| 40-59 | normal |
| 60-69 | prometedor |
| 70-84 | **ganador** |
| 85-100 | **super_ganador** |

### Score por plataforma vs. consolidado

Cada `publications` (una por plataforma) tiene su propio score. Si el mismo `raw_video_id` tiene publicaciones en TikTok **e** Instagram para la misma ventana, Capa 8 calcula además un score consolidado (`platform='consolidated'` en `scores`): **promedio ponderado por views** — la plataforma con más views pesa más en el resultado final, con fallback a promedio simple si no hay views en ninguna.

### Ejemplos reales (salida real de `calculatePerformanceScore()`, benchmark: `avg_views=2000, avg_likes=150, avg_comments=20, avg_shares=40, avg_saves=60, avg_follows=5, avg_engagement_rate=6%, avg_retention_rate=35%`, `sample_count=20`)

| Caso | views | likes | comments | shares | saves | follows | retención | **score** | **clasificación** |
|---|---|---|---|---|---|---|---|---|---|
| Malo | 700 | 53 | 7 | 14 | 21 | 2 | 10% | **16** | malo (además penalización de retención: -10) |
| Normal | 1800 | 135 | 18 | 36 | 54 | 5 | 32% | **51** | normal |
| Prometedor | 2600 | 195 | 26 | 52 | 78 | 7 | 40% | **69** | prometedor |
| Ganador | 3000 | 225 | 30 | 60 | 90 | 8 | 42% | **77** | **ganador** → dispara Capa 9 |
| Super ganador | 4600 | 345 | 46 | 92 | 138 | 12 | 55% | **100** | **super_ganador** (bonus viral: +10) |

**TikTok sin saves/retención** (`saves=null`, `retention_rate=null`, resto igual que "Ganador" pero un poco más alto): `views=3400, likes=255, comments=34, shares=68, follows=8` → **score=85, super_ganador** — el peso de `saves` (20) y `retention` (5) se redistribuyó entre `views`/`shares`/`comments`/`follows`/`engagement`, ninguno quedó "regalado".

**Cuenta chica con benchmark de fallback** (benchmark propio con solo 2 muestras: `avg_views=80, avg_likes=4, avg_shares=1, avg_saves=1`, por debajo de `min_samples_required=5` → se usa el genérico): `views=500, likes=35, comments=4, shares=12, saves=15, follows=2, retention=35%` → **score=91, super_ganador, benchmark_confidence='fallback_generic'** — el sistema SÍ detecta que el video le está yendo muy bien, pero lo etiqueta con confianza baja porque todavía no hay suficiente historial propio de la cuenta para confiar en la comparación.

---

## 4. Provider de métricas

Mismo patrón que Capas 6 (`PublishProvider`): interfaz `MetricsProvider`, adapters intercambiables.

```ts
export interface MetricsSnapshotRequest {
  publication_id: string;
  platform: "tiktok" | "instagram_reels";
  provider: string;
  provider_post_id: string;
  window: "24h" | "48h" | "72h" | "7d";
}

export interface MetricsSnapshotResult {
  ok: boolean;
  source: "api" | "manual" | "estimated";
  confidence_level: "high" | "medium" | "low";
  views: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; follows: number | null;
  profile_visits: number | null; avg_watch_time_sec: number | null;
  retention_rate: number | null; completion_rate: number | null;
  raw_payload: unknown;
  error_message: string | null;
  retryable: boolean;
}
```

- **`mockMetricsProvider`**: determinístico (mismo `provider_post_id` + `window` → mismo resultado siempre, útil para tests reproducibles), simula la curva de crecimiento entre ventanas y simula a propósito la limitación real de TikTok.
- **`uploadPostMetricsProvider`**: best-effort — Upload-Post es un proveedor de **publicación**, no de analítica, así que este adapter probablemente devuelva datos parciales o nada (⚠️ verificar contra su documentación vigente). Cuando faltan campos, `confidence_level` baja a `'low'` automáticamente.
- **Estrategia cuando el proveedor no entrega todo:** no se inventa el dato — se guarda `null`, y el score lo maneja con la redistribución de peso (sección 3). Esto es intencional: TikTok en particular **no expone de forma confiable** guardados ni retención vía API (misma limitación documentada desde `sistema-fabrica-reels-nexoia.md` sección 7 del primer día de este proyecto).
- **Fallback manual:** `POST /metrics/manual` en `metrics-api` + [`scripts/import-metrics-csv.ts`](./fabrica-reels/services/metrics-api/scripts/import-metrics-csv.ts) — para cuando alguien mira TikTok Studio a mano y carga los números en un CSV simple (`publication_id,window,views,likes,...`).
- **Preparación para APIs oficiales:** un `metaDirectMetricsProvider`/`tiktokDirectMetricsProvider` futuro (Instagram Graph API `insights`, TikTok Display API) es un archivo nuevo en `providers/` sin tocar nada más — mismo criterio de desacople que Capa 6.

---

## 5. Workflow n8n Capa 7 — recolección

```
Trigger "Cada 30 min"
  → 0. Detectar snapshots pendientes   [Code, runOnceForAllItems]
      → Procesar de a uno               [Loop Over Items]
          → 1. Tomar snapshot y guardar  [Code, runOnceForEachItem]
          → (vuelve a "Procesar de a uno")
```

- **0.** Para cada `publications.status='published'`, calcula qué ventanas ya vencieron (`published_at + horas_de_la_ventana <= ahora`) y todavía no tienen fila en `post_metrics`.
- **1.** Idempotencia defensiva (relee antes de llamar al provider, aunque el paso 0 ya filtró), llama a `metrics-api /snapshot`, valida plausibilidad, guarda. Si el fallo es transitorio, se deja para el próximo ciclo (no hay contador de reintentos explícito acá — simplemente vuelve a aparecer en "0. Detectar" en la próxima corrida, hasta que la ventana ya no tenga sentido perseguir, decisión operativa simple en vez de un backoff propio). Si es terminal (ej. publicación borrada), se guarda una fila `source='failed'` para no perseguirla más.

---

## 6. Workflow n8n Capa 8 — scoring

```
Trigger "Cada 15 min"
  → 0. Detectar snapshots sin score   [Code, runOnceForAllItems]
      → Procesar de a uno              [Loop Over Items]
          → 1. Calcular y guardar score [Code, runOnceForEachItem]
          → (vuelve a "Procesar de a uno")
```

- **0.** `post_metrics` (`source != 'failed'`) sin fila correspondiente en `scores` (`metric_snapshot_id`).
- **1.** Recalcula benchmark → pide score a `metrics-api` → guarda en `scores` → si es un nuevo mejor score para ese `raw_video_id`, actualiza `best_score`/`performance_classification` → si cruza 70 por primera vez, `variant_generation_status='ready'` + alerta Telegram → si hay 2+ plataformas para el mismo video y ventana, calcula el consolidado.

**Por qué "una vez ganador, siempre ganador":** el `best_score` es el pico, no el promedio ni el último — una ventana de 7 días más floja que el pico de 48h no le saca el título a un video que ya demostró que puede ganar. Es la señal que le importa a Capa 9 (generar variantes de lo que sí funcionó), no un promedio que dilapida la señal.

---

## 7. Integración con Supabase

Ver migración completa en [`fabrica-reels/schema/capa7-8-metrics-scoring.migration.sql`](./fabrica-reels/schema/capa7-8-metrics-scoring.migration.sql). Resumen:

- **Renombres** (continuidad, no tablas nuevas): `metrics`→`post_metrics`, `benchmarks`→`account_benchmarks`.
- **`scores` extendida:** `raw_video_id`, `metric_snapshot_id` (1 score por snapshot, índice único), `platform`, `window`, `benchmark_confidence`, `components` (jsonb con el breakdown completo de `calculatePerformanceScore()`, útil para un dashboard futuro sin recalcular nada).
- **`raw_videos` extendida:** `best_score`, `performance_classification`, `variant_generation_status` — **columnas separadas de `status`** a propósito: `status` es el ciclo de producción (pipeline), esto es una dimensión ortogonal (rendimiento), no se pisan entre sí.
- **Índices:** unicidad `(publication_id, snapshot_window)` en `post_metrics`, `(client_id, platform, window)` en `account_benchmarks`, `(metric_snapshot_id)` y `(raw_video_id, window, platform)` en `scores`, más un índice parcial en `raw_videos` para `variant_generation_status='ready'` (la cola que va a leer Capa 9).
- **Vistas para dashboard futuro:** `v_client_winners` (ganadores actuales por cliente) y `v_weekly_performance` (posts/semana, score promedio, cantidad de ganadores — insumo directo del reporte semanal de Capa 10).
- **RLS:** mismo criterio multi-cliente que todas las capas anteriores (`service_role` para n8n/servicios, plantilla comentada para el portal futuro).

**Ajuste a Capa 6 que se hizo al construir esto:** `raw_videos.status` nunca pasaba a `'published'` después de una publicación real exitosa (se quedaba en `'approved_for_publish'` para siempre) — Capa 7 no lo necesitaba para su propio trigger (usa `publications.status`), pero cualquier vista o reporte que mirara `raw_videos.status` directamente quedaba desactualizado. Se agregó esa actualización en `capa6-02-publicar-con-lock.js`.

---

## 8. Manejo de errores

| Caso | Dónde se detecta | Qué pasa |
|---|---|---|
| Provider sin métricas para esa plataforma | `MetricsSnapshotResult.ok=false` con campos en `null` | se guarda igual con `confidence_level='low'`, no bloquea el resto de las métricas disponibles |
| Token vencido | `uploadPostMetricsProvider` detecta HTTP 401/403 | `retryable:false`, requiere reconectar (mismo criterio que Capa 6) |
| Publicación no encontrada | "1. Tomar snapshot" no encuentra la fila en `publications` | se salta ese item, no rompe el resto del batch |
| Snapshot duplicado | Índice único `(publication_id, snapshot_window)` + chequeo explícito antes de llamar al provider | nunca se pide/gasta un snapshot dos veces para la misma ventana |
| Datos parciales | Cualquier campo `null` en `MetricsSnapshotResult` | se guarda `null` (nunca `0`) — el scoring redistribuye peso en vez de castigar con un cero falso |
| Métricas con valores imposibles | Chequeo en "1. Tomar snapshot": negativos, o `likes > views*5` | se guarda igual (no se descarta el dato) pero con `confidence_level='low'` forzado + alerta Telegram para revisión humana |
| Publicación removida | El provider devuelve 404/error terminal al pedir el snapshot | se guarda `source='failed'`, no se vuelve a perseguir esa ventana |
| Rate limits | Provider devuelve 429 | `retryable:true`, la ventana vuelve a aparecer en "0. Detectar" el próximo ciclo (30 min después) |
| Benchmark insuficiente | `account_benchmarks.sample_count < min_samples_required` | se usa el benchmark genérico de fallback, `benchmark_confidence='fallback_generic'` en el score resultante (nunca se bloquea el cálculo por falta de historial) |
| Diferencias entre TikTok e Instagram | `saves`/`retention_rate`/`avg_watch_time_sec` suelen venir `null` en TikTok | redistribución de peso (sección 3) + el score consolidado usa promedio ponderado por views, no promedia "peras con manzanas" campo por campo |

---

## 9-10. Documentación de prueba y entregables

### Cómo probar con mock data

```bash
cd fabrica-reels/services/metrics-api
npm install
npm start   # :3004

# Snapshot simulado (determinístico -- mismo provider_post_id+window siempre da lo mismo)
curl -X POST http://localhost:3004/snapshot \
  -H "Content-Type: application/json" \
  -d '{"publication_id":"test-1","platform":"instagram_reels","provider":"mock","provider_post_id":"mock_post_123","window":"24h"}'

# El mismo post a TikTok -- comparar cómo saves/retention salen null
curl -X POST http://localhost:3004/snapshot \
  -H "Content-Type: application/json" \
  -d '{"publication_id":"test-1","platform":"tiktok","provider":"mock","provider_post_id":"mock_post_123","window":"24h"}'

# Calcular un score directo, sin pasar por Supabase
curl -X POST http://localhost:3004/score \
  -H "Content-Type: application/json" \
  -d '{
    "views": 3000, "likes": 225, "comments": 30, "shares": 60, "saves": 90, "follows": 8, "retention_rate": 0.42,
    "benchmark": {"avg_views":2000,"avg_likes":150,"avg_comments":20,"avg_shares":40,"avg_saves":60,"avg_follows":5,"avg_engagement_rate":0.06,"avg_retention_rate":0.35,"sample_count":20},
    "min_samples_required": 5
  }'
# → {"score":77,"classification":"ganador", ...}
```

### Variables de entorno

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | igual que capas anteriores |
| `METRICS_API_URL` | ej. `http://localhost:3004` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alertas de ganador/super ganador y de datos implausibles |
| `UPLOAD_POST_API_KEY`, `UPLOAD_POST_API_URL` | solo si se usa `uploadPostMetricsProvider` |

### Limitaciones reales de cada métrica (honestas, no cosméticas)

| Métrica | Instagram Reels | TikTok |
|---|---|---|
| Views, likes, comments, shares | Confiables vía Graph API (cuenta Business/Creator) | Confiables vía Display API |
| Saves (guardados) | Confiable | **No expuesto de forma confiable vía API pública** — requiere carga manual (TikTok Studio) |
| Retención / tiempo promedio de vista | Confiable vía `insights` | **No expuesto de forma confiable** — mismo camino manual |
| Seguidores generados por un post puntual | Es una aproximación siempre (ninguna plataforma da esto limpio por post) — se calcula como delta de seguidores totales de la cuenta en la ventana, asumiendo que ese fue el único post relevante ese período | Misma limitación |
| Profile visits | Disponible | Parcialmente disponible según cuenta |

### Checklist de QA — Capa 7-8 lista cuando:

- [ ] Con `provider='mock'`, una publicación en `published` genera sus 4 snapshots (24h/48h/72h/7d) a medida que se cumplen los plazos, sin duplicados.
- [ ] Cada snapshot dispara su propio score en Capa 8 dentro de los siguientes 15 minutos, visible en `scores` con `metric_snapshot_id` poblado.
- [ ] `account_benchmarks` se actualiza después de cada score calculado, y el `sample_count` sube.
- [ ] Un video cuyo score cruza 70 por primera vez deja `raw_videos.variant_generation_status='ready'` y llega la alerta de Telegram — un score posterior más bajo NO le saca el `best_score`/`performance_classification` ya alcanzado.
- [ ] Un video con score ≥85 queda clasificado `super_ganador` y el mensaje de Telegram lo distingue de un `ganador` normal.
- [ ] Publicando el mismo `raw_video_id` en `tiktok` e `instagram_reels` (dos filas de `publications`), aparece una fila adicional en `scores` con `platform='consolidated'` una vez que ambas plataformas tienen score para la misma ventana.
- [ ] Forzando un snapshot con `likes` mayor a 5x las `views`, la fila se guarda igual pero con `confidence_level='low'` y llega la alerta de "valores poco plausibles".
- [ ] Una cuenta con menos de 5 muestras históricas usa el benchmark de fallback (`benchmark_confidence='fallback_generic'` en el score resultante), no se rompe ni devuelve un score sin sentido.
- [ ] `npm run import-csv -- archivo.csv` en `metrics-api` carga snapshots manuales correctamente, con `source='manual'`.

### Entregables

- [x] `capa7-metrics.workflow.json`, `capa8-scoring.workflow.json` (workflows separados, ver justificación al inicio del documento)
- [x] `capa7-8-metrics-scoring.migration.sql`
- [x] Este documento
- [x] Contrato `MetricsProvider`: [`fabrica-reels/services/metrics-api/src/types.ts`](./fabrica-reels/services/metrics-api/src/types.ts)
- [x] `mockMetricsProvider`: [`fabrica-reels/services/metrics-api/src/providers/mockMetricsProvider.ts`](./fabrica-reels/services/metrics-api/src/providers/mockMetricsProvider.ts)
- [x] `uploadPostMetricsProvider`: [`fabrica-reels/services/metrics-api/src/providers/uploadPostMetricsProvider.ts`](./fabrica-reels/services/metrics-api/src/providers/uploadPostMetricsProvider.ts) (⚠️ best-effort, verificar contra la documentación vigente)
- [x] `calculatePerformanceScore()`: [`fabrica-reels/services/metrics-api/src/scoring.ts`](./fabrica-reels/services/metrics-api/src/scoring.ts)
- [x] Ejemplos de score verificados (malo/normal/prometedor/ganador/super ganador) — sección 3

**Nota de calidad:** todo el TypeScript de `metrics-api` pasa `tsc --noEmit` sin errores, y los 5 ejemplos de la sección 3 son la salida real de ejecutar `calculatePerformanceScore()` (no números inventados a mano) — el primer intento de armar esos ejemplos, de hecho, dio casi todo `super_ganador` porque los valores de entrada elegidos a mano estaban muy por encima del benchmark; se recalibraron corriendo la función real hasta que cada caso cayera en su banda esperada, que es exactamente el tipo de error que uno quiere descubrir probando el código en vez de describiéndolo en prosa.

## Configuración en n8n Community (sin variables de entorno de servidor)

Después de importar `capa7-metrics.workflow.json y capa8-scoring.workflow.json`, abre el nodo `0. Config` y completa sus campos manualmente. Los secretos se entregan vacíos; no los guardes en archivos versionados.

- `SUPABASE_URL`: URL base del proyecto Supabase (por ejemplo, `https://<proyecto>.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY`: clave `service_role` de Supabase.
- `TELEGRAM_BOT_TOKEN`: token del bot de Telegram.
- `TELEGRAM_CHAT_ID`: chat ID de Telegram usado como destino de respaldo para alertas.
- `METRICS_API_URL`: URL base alcanzable del servicio metrics-api, sin barra final.
