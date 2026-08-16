# Workflows n8n — Capa 3 y Capa 4

## Capa 3 — "Edit Director"

Workflow importable: [`capa3-edit-director.workflow.json`](./capa3-edit-director.workflow.json)
Documentación completa: [`../../capa3-edit-director-n8n.md`](../../capa3-edit-director-n8n.md)

Detecta `raw_videos.status='assets_ready'`, genera el `edit_spec` con el LLM, lo valida (repair loop de hasta 3 intentos) y lo deja en `edit_spec_ready`.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002
```

## Capa 4 — "Render automático"

Workflow importable: [`capa4-render.workflow.json`](./capa4-render.workflow.json)
Documentación completa: [`../../capa4-render.md`](../../capa4-render.md)

Detecta `raw_videos.status='edit_spec_ready'`, dispara el render (async) con `personal_brand_clean`, sube el MP4 a Supabase Storage, deja el video en `rendered_pending_review` y manda la alerta de revisión por Telegram con botones aprobar/rechazar/pedir variante.

**Servicios que necesita corriendo:**
```bash
cd fabrica-reels/remotion && npm install && npm run render:service   # :3001
```

## Cómo importar cualquiera de los dos

1. n8n → Workflows → Import from File.
2. Revisar visualmente los nodos **"Procesar de a uno"** (Loop Over Items /
   Split In Batches, presentes en ambos workflows): sus dos salidas son
   "done" (índice 0, sin nada conectado, fin del ciclo) y "loop" (índice 1,
   conecta al resto del flujo). El orden exacto de estos índices varía un
   poco según la versión de n8n — si al importar el wiring queda cruzado,
   es el único lugar donde hay que corregir a mano.
3. Cargar las env vars (ver tabla en cada doc).
4. Crear la credencial de Telegram Bot en n8n y asignarla a los nodos
   `n8n-nodes-base.telegram` / `telegramTrigger`.
5. En Capa 4, además: configurar `N8N_RENDER_CALLBACK_URL` en el entorno
   del render service apuntando a la URL pública del nodo Webhook
   `Recibir resultado de render` de ese workflow (n8n te la da al abrir el
   nodo — "Test URL" mientras development, "Production URL" con el
   workflow activo).
6. Activar.

## Orden recomendado para levantar todo

```bash
# Terminal 1
cd fabrica-reels/services/edit-spec-api && npm install && npm start   # :3002

# Terminal 2
cd fabrica-reels/remotion && npm install && npm run render:service    # :3001

# Terminal 3: n8n, con Capa 3 y Capa 4 importadas y activas
```
