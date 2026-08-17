# Capa 9: motor de variantes

**Objetivo:** consumir ganadores y pedidos manuales desde
`raw_videos.variant_generation_status='ready'`, convertir el aprendizaje del
video en 2-3 re-cortes automaticos (Tipo B) y 5-7 guiones nuevos (Tipo A), y
cerrar la cola sin reprocesar el mismo ganador.

**Criterio de exito:** un item `ready` termina en `variants_generated`, con
cada Tipo B validada en una nueva version de `edit_specs`, cada Tipo A en
`scripts.status='pendiente_grabacion'`, y una alerta con ambos conteos.

**Codigo real:** workflow
[`capa9-variant-engine.workflow.json`](./fabrica-reels/n8n/capa9-variant-engine.workflow.json),
code-nodes [`capa9-*.js`](./fabrica-reels/n8n/code-nodes), migracion
[`capa9-variant-engine.migration.sql`](./fabrica-reels/schema/capa9-variant-engine.migration.sql),
prompt [`variant-director-system-prompt.md`](./fabrica-reels/prompts/variant-director-system-prompt.md)
y [pruebas](./fabrica-reels/n8n/tests/capa9-code-nodes.test.js).

---

## 1. Workflow n8n

```text
Cada 15 min
  -> 0. Detectar ganadores listos                    [Code, todos]
  -> Procesar de a uno                               [Loop, batch=1]
     -> 1. Claim atomico + contexto + prompt          [Code]
     -> 2. Llamar Variant Director                    [Code]
     -> 3. Validar/reparar cada Tipo B (max. 3)       [Code]
     -> 4. Persistir lote + variants_generated        [Code]
     -> vuelve al loop

Errores de 1-4 -> 99. Marcar failed + alertar -> vuelve al loop
```

Cada Code node hace sus llamadas con `this.helpers.httpRequest`, igual que
las Capas 3-8. El workflow embebe exactamente el contenido de los archivos
sueltos.

### Claim e idempotencia

El nodo 1 hace un `PATCH` condicionado por
`variant_generation_status=eq.ready`. Solo quien recibe una fila continua;
dos polls solapados no generan dos lotes. La persistencia usa
`generation_key` estable (`raw_video_id:capa9:A|B:indice`) y upsert: un
reintento despues de una escritura parcial no duplica filas.

El estado final es `variants_generated`. En error se usa `failed` con
`variant_generation_error`; un operador puede inspeccionarlo y devolverlo a
`ready`. El trigger SQL convierte `raw_videos.status='variant_requested'`
(Capa 5) en la misma cola `ready`.

---

## 2. Contexto y decision Tipo A / Tipo B

El nodo 1 carga transcript con timestamps, `analyses`, `assets`, brand kit,
el score mas alto con `scores.components`, `best_score`, clasificacion, el
ultimo `edit_spec` valido y, si fue pedido manual, el ultimo
`review_actions.variant_type/comment` asociado a sus renders.

El Variant Director debe justificar el mecanismo ganador con esa evidencia.
El primer elemento compatible respeta el pedido manual. La salida contiene
2-3 Tipo B primero y 5-7 Tipo A despues; el nodo 2 rechaza cantidades, orden
o campos obligatorios incorrectos.

### Tipo B: re-corte automatico

Reutiliza `source_video`, `raw_video_id`, plataforma y branding. El LLM
produce el `edit_spec` completo. Cada spec pasa por `POST /validate`; si
falla, se pide `POST /repair-prompt`, se llama nuevamente al LLM con
temperatura 0.2 y se revalida. Son como maximo tres intentos totales por spec
(original + dos reparaciones). Si una Tipo B sigue invalida, no se finaliza
el lote.

Las specs validas se insertan con version incremental,
`parent_edit_spec_id`, `variant_type_origen`, `validation_status='valid'` y
la cantidad real de reparaciones.

### Tipo A: nuevo guion

Se guarda en `scripts` con `parent_video_id`, `idea`, `hook`, `guion`,
`angulo`, `variant_type='A_requiere_grabacion'`, `variant_type_origen` y
`status='pendiente_grabacion'`. Al grabarse, vuelve a entrar por Capa 1; Capa
9 no crea un video fuente ficticio.

---

## 3. Prompt y API compartida

`GET /prompts/variant-director-system` concatena las reglas del Variant
Director, el prompt completo del Edit Director para Tipo B y la voz Nexo.IA.
Los Markdown son la unica fuente de verdad. Validacion y reparacion reutilizan
`POST /validate` y `POST /repair-prompt`.

---

## 4. Migracion y datos

- `scripts`: `parent_video_id`, `variant_type_origen`, `generation_key`.
- `edit_specs`: `parent_edit_spec_id`, `variant_type_origen`,
  `generation_key`.
- `raw_videos`: timestamps, intentos y ultimo error de generacion.
- Indices unicos parciales e indices para las colas.
- Trigger que encola pedidos manuales de Capa 5.

No se crea una tabla `variants`: Tipo A pertenece a `scripts` y Tipo B a
`edit_specs`, como define el modelo original.

---

## 5. Manejo de errores

| Caso | Deteccion | Resultado |
|---|---|---|
| Poll duplicado | claim devuelve cero filas | el segundo item termina sin llamar al LLM |
| Contexto incompleto | nodo 1 | error output, estado `failed` |
| LLM no devuelve JSON | nodo 2 | parse error guardado, `failed` |
| Cantidad/orden A-B incorrecto | nodo 2 | `failed`, no persiste lote |
| Tipo B invalida | `/validate` | repair loop; tercer fallo -> `failed` |
| Red/API caida | excepcion de `httpRequest` | nodo 99; el batch continua |
| Fallo parcial al persistir | nodo 4 | `failed`; reintento hace upsert |
| Telegram falla tras persistir | `try/catch` | lote sigue finalizado; output reporta fallo |
| Proceso muere sin error | queda `in_progress` | operacion manual; ver limitaciones |

---

## 6. Ejemplo real ejecutado

Salida real del test de persistencia con HTTP simulado:

```json
{
  "raw_video_id": "raw-1",
  "outcome": "variants_generated",
  "type_a_count": 5,
  "type_b_count": 2,
  "telegram_alert": "sent"
}
```

Resultado real del 17-08-2026:

```text
npm run test:capa9
tests 5
pass 5
fail 0
duration_ms 228.8296
```

Los mocks verifican la URL de la cola, contrato 2B+5A, rechazo de cantidades
invalidas, reparacion/revalidacion y las escrituras exactas (2 `edit_specs`,
5 `scripts`, PATCH final y Telegram).

---

## 7. Variables de entorno

| Variable | Uso |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | PostgREST |
| `EDIT_SPEC_API_URL` | prompt, validacion y reparacion |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_VERSION` | llamadas al LLM |
| `VARIANT_DIRECTOR_MODEL` | modelo; fallback a `EDIT_DIRECTOR_MODEL` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alertas |

---

## 8. Checklist de QA

- [x] El workflow parsea y sus seis `jsCode` coinciden con los archivos sueltos.
- [x] Pruebas locales: 5/5 pasan con `node --test`.
- [x] TypeScript de `edit-spec-api`: `tsc --noEmit` termina sin errores.
- [x] El test cubre 2 Tipo B antes de 5 Tipo A y rechazo fuera de rango.
- [x] El test cubre repair + revalidacion y contador de intentos.
- [x] El test cubre 2 `edit_specs`, 5 `scripts` y estado final.
- [ ] Aplicar la migracion en Supabase de staging.
- [ ] Importar/activar el workflow y verificar error outputs en esa version de n8n.
- [ ] Ejecutar con Anthropic real y revisar visualmente los MP4 Tipo B.
- [ ] Confirmar alertas reales al chat Telegram del cliente.

---

## 9. Limitaciones conocidas

- Las pruebas no contactan Supabase, Anthropic, n8n ni Telegram reales; se
  necesitan credenciales/servicios de staging.
- Un crash duro despues del claim puede dejar el item `in_progress`. Se
  guarda `variant_generation_started_at`, pero no hay sweep automatico.
- `generation_key` fija un lote por ganador. Volver a `ready` recupera o
  completa ese lote; una segunda revision deliberada requiere versionar la
  clave de lote.
- Las Tipo B comparten el `raw_video_id`; dashboards deben distinguirlas por
  `edit_specs.id`/`generation_key`.
- Validez estructural no garantiza calidad editorial; la revision humana de
  Capa 5 sigue siendo obligatoria.
