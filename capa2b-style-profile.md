# Capa 2B: perfil de estilo

**Objetivo:** convertir un lote on-demand de referencias en un `style_profile` reusable por cliente, para que el Edit Director aplique patrones observados junto al brand kit.

**Criterio de éxito:** `POST /style-profiles` responde `202`, la cola pasa `pending → in_progress → active`, conserva análisis por fuente y deja una sola versión activa por cliente.

**Código real:** endpoint y extracción en `fabrica-reels/services/edit-spec-api`, workflow `fabrica-reels/n8n/capa2b-style-profile.workflow.json`, code-nodes `capa2b-*`, prompt, migración y tests.

## 1. Flujo e idempotencia

El endpoint valida `client_id`, `label` y 1-20 URLs HTTP(S), calcula la versión siguiente e inserta la solicitud. El poll reclama con PATCH condicionado por `status=pending`; un poll solapado no analiza dos veces. Cada referencia aporta cinco frames (10/30/50/70/90%). Anthropic Vision produce un análisis estructurado y una segunda llamada consolida únicamente patrones repetidos, dejando contradicciones en `exceptions`. Al activar una versión se archiva la activa anterior. Los errores dejan el perfil en `failed` con `processing_error`.

## 2. Datos e integración con Capa 3

`style_profiles` guarda `fonts`, `color_palette`, `cut_pacing`, `card_patterns`, `audio_notes`, fuentes, estado, fecha y versión. `GET /prompts/edit-director-system?client_id=...` incorpora la versión activa; si no existe o Supabase no está disponible, devuelve el prompt actual sin bloquear Capa 3.

## 3. Variables

Reutiliza `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EDIT_SPEC_API_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_VERSION` y `EDIT_DIRECTOR_MODEL`.

## 4. QA y pendientes

- [x] Endpoint, cola, claim, análisis multi-frame y consolidación.
- [x] Integración Edit Director con fallback.
- [x] Tests de nodos y paridad workflow/code-node.
- [ ] Aplicar migración e importar/activar workflow en staging.
- [ ] Ejecutar con videos y credenciales reales.

## 5. Limitaciones conocidas

Frames, metadata y transcript no contienen señal de audio. Música y SFX son **no verificables solo con frames+transcript**: `audio_notes.status` queda `no_verificable_sin_audio` y `music`/`sfx` en `null`. No se implementa mezcla real de audio.
