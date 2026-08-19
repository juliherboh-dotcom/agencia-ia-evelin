# Capa 3.5: QA visual por corte

**Objetivo:** impedir que un `edit_spec` avance a render si cualquier instante representativo de un corte conservado tiene un defecto visual.

**Criterio de éxito:** cada corte `keep:true` se revisa en inicio, 33%, 66% y fin; todos aprobados habilitan Capa 4, y cualquier fallo queda bloqueado hasta decisión humana.

**Código real:** workflow `fabrica-reels/n8n/capa3-5-cut-qa.workflow.json`, code-nodes `capa3-5-*`, prompt, migración, guard de Capa 4 y tests.

## 1. Flujo e idempotencia

El poll toma specs `ready`, válidos y `pending`; el PATCH condicionado los reclama como `in_progress`. Anthropic Vision devuelve un resultado por corte. Cada ejecución agrega filas a `cut_qa_results` (auditoría append-only). Un error técnico libera el claim a `pending` para reintento.

## 2. Resultado y revisión

Si todos son `ok:true`, el spec pasa a `passed` y el video vuelve a `edit_spec_ready`; Capa 4 exige expresamente `cut_qa_status=passed`. Si existe un fallo, queda `flagged` y Telegram recibe fotos, timestamp, motivo y botones. “Aprobar igual” fuerza `passed`; “Pedir regenerar ese corte” rechaza esa versión, guarda el feedback y reencola Capa 3. Las decisiones validan que el usuario sea reviewer activo del cliente.

## 3. Variables

Reutiliza `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EDIT_SPEC_API_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_VERSION`, `EDIT_DIRECTOR_MODEL`, `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

## 4. QA y pendientes

- [x] Cuatro frames por corte, resultado estructurado y auditoría.
- [x] Gate de Capa 4 y feedback de regeneración a Capa 3.
- [x] Fotos, botones, idempotencia y autorización Telegram.
- [ ] Aplicar migración e importar/activar workflow en staging.
- [ ] Probar Anthropic, ffmpeg, Supabase y Telegram reales.

## 5. Limitaciones conocidas

Este QA evalúa imagen, no señal sonora. Música y SFX son **no verificables solo con frames+transcript** y quedan fuera de la decisión; no se implementa mezcla real de audio. Cuatro muestras reducen el riesgo, pero no equivalen a inspeccionar cada frame del video.

## Configuración en n8n Community (sin variables de entorno de servidor)

Después de importar `capa3-5-cut-qa.workflow.json`, abre el nodo `0. Config` y completa sus campos manualmente. Los secretos se entregan vacíos; no los guardes en archivos versionados.

- `SUPABASE_URL`: URL base del proyecto Supabase (por ejemplo, `https://<proyecto>.supabase.co`).
- `SUPABASE_SERVICE_ROLE_KEY`: clave `service_role` de Supabase.
- `ANTHROPIC_API_KEY`: API key de Anthropic.
- `ANTHROPIC_VERSION`: versión de la API de Anthropic; dejar `2023-06-01` salvo cambio explícito.
- `EDIT_DIRECTOR_MODEL`: modelo Anthropic del Edit Director; queda precargado como `claude-sonnet-4-20250514`.
- `TELEGRAM_BOT_TOKEN`: token del bot de Telegram.
- `TELEGRAM_CHAT_ID`: chat ID de Telegram usado como destino de respaldo para alertas.
- `EDIT_SPEC_API_URL`: URL base alcanzable del servicio edit-spec-api, sin barra final.
