# Capa 3 — workflow n8n "Edit Director"

Workflow importable: [`capa3-edit-director.workflow.json`](./capa3-edit-director.workflow.json)
Nodos Code como archivos sueltos (para leer/testear fuera de n8n): [`code-nodes/`](./code-nodes)

Documentación completa (prompts, ejemplo end-to-end, manejo de errores, checklist de QA): [`../../capa3-edit-director-n8n.md`](../../capa3-edit-director-n8n.md) en la raíz del repo.

## Cómo importar

1. n8n → Workflows → Import from File → `capa3-edit-director.workflow.json`.
2. Revisar visualmente el nodo **"Procesar de a uno"** (Loop Over Items /
   Split In Batches): sus dos salidas son "done" (índice 0, sin nada
   conectado, fin del ciclo) y "loop" (índice 1, conecta al resto del
   flujo). El orden exacto de estos índices varía un poco según la
   versión de n8n — si al importar el wiring queda cruzado, es el único
   lugar del workflow donde hay que corregir a mano.
3. Cargar las env vars (ver tabla en el doc principal).
4. Crear la credencial de Telegram Bot en n8n y asignarla a los dos nodos
   `n8n-nodes-base.telegram`.
5. Activar.

## Servicios que este workflow necesita corriendo

```bash
# Terminal 1
cd fabrica-reels/services/edit-spec-api
npm install
npm start          # :3002 -- /validate, /repair-prompt, /prompts/edit-director-system

# Terminal 2: n8n (self-hosted o cloud), con las env vars cargadas
```

No necesita el servicio de render (`fabrica-reels/remotion`, Capa 4) corriendo — este workflow termina en `edit_spec_ready`, no dispara renders.
