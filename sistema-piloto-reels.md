# Sistema Piloto Automático de Reels — Plan técnico y comercial

**Para:** marca personal (validación interna antes de ofrecerlo como servicio Nexo.IA)
**Versión:** MVP semi-automático → escalable
**Fecha:** 2026-08-16

> Principio rector: no se construye "el sistema perfecto". Se construye la cadena mínima que convierte "grabé 10 videos el domingo" en "se publicó 1 reel optimizado cada día", con humano en el loop en los 2-3 puntos donde el humano todavía aporta más que la IA (selección final de clip, aprobación de caption, criterio de qué grabar).

---

## 1. Arquitectura del sistema

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
│  1. CAPTURA │ ──▶ │ 2. INGESTA   │ ──▶ │ 3. IA: ANÁLISIS    │ ──▶ │ 4. ASSETS    │
│  (celular)  │     │  Drive → BD  │     │  transcribe+score  │     │  captions/   │
└─────────────┘     └──────────────┘     └───────────────────┘     │  hooks/títs. │
                                                                     └──────┬───────┘
                                                                            ▼
┌──────────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────────────┐
│ 8. REPORTE   │ ◀── │ 7. SCORING /  │ ◀── │ 6. MÉTRICAS  │ ◀── │ 5. EDICIÓN        │
│ semanal +    │     │ DETECCIÓN DE  │     │ 24/48/72h/7d │     │ (semi-manual) +   │
│ alertas      │     │ GANADORES     │     │              │     │ PUBLICACIÓN       │
└──────┬───────┘     └───────┬───────┘     └──────────────┘     └──────────────────┘
       │                     │
       ▼                     ▼
┌─────────────────────────────────────┐
│ 9. MOTOR DE VARIANTES (si score≥70) │
│ → vuelve a la cola de "por grabar"  │
└─────────────────────────────────────┘
```

**Capas:**
1. **Captura** — humano, fuera del sistema (batch de grabación semanal/quincenal).
2. **Almacén de verdad** — Airtable (no Sheets: necesitas relaciones, vistas filtradas, adjuntos y automations nativas; Sheets se queda corto apenas pases de ~50 videos).
3. **Orquestador** — n8n (self-hosted u n8n Cloud). Es el "sistema nervioso": escucha Drive, llama OpenAI/Claude, escribe en Airtable, dispara publicación, consulta métricas, manda alertas.
4. **Cerebro de contenido** — Claude o GPT-4.1/5 vía API para transcripción-análisis, generación de assets y motor de variantes.
5. **Edición** — semi-manual (ver sección 5), con automatización parcial vía API donde existe.
6. **Publicación** — Metricool o Publer como capa intermedia (ver sección 6) porque IG/TikTok no dan APIs de publicación abiertas y gratuitas para cuentas personales sin aprobación especial.
7. **Medición** — pull programado de métricas + fallback manual cuando la API no alcanza.
8. **Reporting/alertas** — n8n → WhatsApp (vía Twilio o Meta Cloud API) / Telegram bot / email.

---

## 2. Base de datos — Airtable (recomendado sobre Sheets)

**Por qué Airtable y no Sheets:** adjuntos nativos (video/thumbnail), vistas tipo Kanban por "Estado", relaciones entre tabla de Videos y tabla de Métricas por fecha (histórico 24h/48h/72h/7d sin pisar datos), fórmulas y automations nativas, API REST limpia para n8n. Sheets sirve solo si el presupuesto es \$0 y hay <20 videos/mes.

### Tabla 1: `Videos`

| Campo | Tipo | Notas |
|---|---|---|
| ID_Video | Autonumber / fórmula `VID-{fecha}-{num}` | Clave primaria |
| Nombre_Archivo | Texto | Nombre en Drive |
| Link_Original | URL (adjunto Drive) | |
| Fecha_Subida | Fecha | Trigger de Drive |
| Transcripción | Texto largo | Whisper/Claude |
| Tema | Texto | IA lo infiere |
| Categoría | Select: educativo / historia personal / venta / autoridad / polémico / tendencia / prueba social | |
| Hook_Principal | Texto | Primeras 1-3 líneas transcritas |
| Hook_Score | Número 1-10 | Fuerza del hook |
| Plataforma_Destino | Multi-select: IG / TikTok / Ambas | |
| Estado | Select: Nuevo → Transcrito → Assets generados → En edición → Listo para publicar → Publicado → Medido → Archivado | Motor del Kanban |
| Fecha_Publicación | Fecha/hora | |
| Caption_IG | Texto largo | |
| Caption_TikTok | Texto largo | |
| Hashtags | Texto | |
| Títulos_Sugeridos | Texto largo | Lista de 5 |
| Hooks_Alternativos | Texto largo | Lista de 3 |
| Descripción_Objetivo | Texto | 1 línea: qué logra el video |
| Recomendación_Edición | Texto largo | |
| Score_Calidad | Número 1-10 | Score inicial pre-publicación |
| Video_Padre | Link a este mismo table | Si es variante de un ganador |
| Link_a_Métricas | Link → tabla `Métricas` | 1 a muchos |
| Score_Rendimiento | Rollup/fórmula 0-100 | Ver sección 8 |
| Decisión | Select: Repetir / Mejorar / Descartar | Se llena tras medir 7 días |

### Tabla 2: `Métricas` (una fila por video x ventana de tiempo)

| Campo | Tipo |
|---|---|
| Video (link) | Link a `Videos` |
| Plataforma | Select IG/TikTok |
| Ventana | Select: 24h / 48h / 72h / 7d |
| Fecha_Medición | Fecha |
| Views | Número |
| Likes | Número |
| Comentarios | Número |
| Compartidos | Número |
| Guardados | Número |
| Seguidores_Generados | Número (delta de seguidores de la cuenta en esa ventana, aproximado) |
| Retención_Promedio | Número % (si disponible) |
| Duración_Promedio_Vista | Segundos (si disponible) |

*(Separar Métricas de Videos en tabla propia es lo que te permite guardar 4 mediciones por video sin pisar datos — error típico de MVPs mal diseñados que solo dejan 1 campo "Views" y lo sobrescriben.)*

### Tabla 3: `Cuenta_Benchmark`
Guarda promedios móviles de la cuenta (views promedio últimos 30 días, engagement rate promedio) para poder calcular "views sobre el promedio" — necesario para el score de rendimiento. Se actualiza semanalmente con una fórmula/automation.

### Tabla 4: `Variantes_Generadas`
Cola de ideas nuevas generadas por el motor de variantes (sección 9), con campos: Idea, Hook, Guion, Ángulo, Basado_en (link a video ganador), Estado (Por grabar / Grabado / Descartado).

---

## 3. Transcripción y análisis — flujo n8n

**Trigger:** n8n → nodo **Google Drive Trigger** ("File Created" en carpeta `/RAW`) cada 5-15 min.

**Pasos:**
1. Drive Trigger detecta archivo nuevo → descarga a n8n (o pasa link directo).
2. Nodo **Airtable: Create Record** en `Videos` con Estado=`Nuevo`.
3. Nodo **HTTP Request** a OpenAI Whisper API (`whisper-1` o `gpt-4o-transcribe`) → transcripción.
4. Nodo **Airtable: Update Record** → guarda Transcripción, Estado=`Transcrito`.
5. Nodo **HTTP Request** a Claude/OpenAI con el **Prompt de Análisis** (abajo) → devuelve JSON con tema, categoría, hook, hook_score, score_calidad.
6. Nodo **Airtable: Update Record** con esos campos.

### Prompt de análisis (system + user, para Claude)

```
SYSTEM:
Eres un analista de contenido experto en Reels/TikTok para marcas personales.
Analizas transcripciones de video crudo y devuelves SIEMPRE un JSON válido,
sin texto adicional, con este esquema exacto:

{
  "tema": "string, 3-6 palabras",
  "categoria": "educativo|historia_personal|venta|autoridad|polemico|tendencia|prueba_social",
  "hook_principal": "las primeras 1-2 frases dichas, tal como aparecen",
  "hook_score": integer 1-10,
  "hook_diagnostico": "string, 1 frase: por qué funciona o no el hook",
  "score_calidad": integer 1-10,
  "score_diagnostico": "string, 1 frase",
  "descripcion_objetivo": "string, 1 frase: qué logra este video para la marca"
}

Criterios de hook_score:
- 9-10: promesa clara + curiosidad o tensión en los primeros 3 segundos, sin relleno.
- 6-8: hay gancho pero tarda en llegar o es genérico ("Hoy les quiero contar...").
- 1-5: arranca con contexto/saludo antes del gancho, o no hay gancho identificable.

Criterios de score_calidad (1-10): combina fuerza del hook, claridad del mensaje,
si hay una sola idea central (no 3 mezcladas), si cierra con CTA o remate,
y si el tema es específico (no genérico tipo "consejos de productividad").

USER:
Transcripción del video:
"""
{{transcripcion}}
"""
Plataforma destino: {{plataforma}}
Nicho/tema de la marca: {{nicho_marca}}
```

Este mismo patrón (system fijo + JSON estricto) es el que se reutiliza en todos los prompts de abajo — así los nodos de n8n solo hacen `JSON.parse()` sobre la respuesta sin fricción.

---

## 4. Generación de assets — prompt de captions/hooks

Se dispara automáticamente después del análisis (Estado `Transcrito` → `Assets generados`).

```
SYSTEM:
Eres copywriter especialista en Reels/TikTok para marcas personales.
Devuelves SIEMPRE JSON válido con este esquema:

{
  "titulos": ["5 opciones de título/portada, máx 6 palabras cada una"],
  "captions_instagram": ["3 opciones, 2-4 líneas, con 1 pregunta o CTA al final"],
  "captions_tiktok": ["3 opciones, más directas/coloquiales que IG, máx 2 líneas"],
  "hashtags": ["10 hashtags, mezcla de 3 amplios + 4 de nicho + 3 de nicho específico"],
  "hooks_alternativos": ["3 reescrituras del hook original, mismo mensaje, distinto ángulo (curiosidad / dato duro / confesión)"],
  "recomendacion_edicion": "string: qué cortar, dónde poner el primer corte/zoom, si necesita subtítulos quemados, música sugerida (energía, no track específico)"
}

Reglas:
- No uses emojis en exceso (máx 2 por caption).
- No repitas la misma palabra de gancho en los 3 hooks alternativos.
- Los hashtags no deben ser genéricos tipo #reels #viral #fyp como único contenido.

USER:
Tema: {{tema}}
Categoría: {{categoria}}
Hook original: {{hook_principal}}
Transcripción completa: """{{transcripcion}}"""
Marca/nicho: {{nicho_marca}}
Tono de la marca: {{tono_marca}}
```

Output → nodo Airtable Update con todos los campos + Estado=`Assets generados`.

---

## 5. Edición semi-automática — qué herramienta usar

| Herramienta | Qué hace bien | API disponible | Rol recomendado |
|---|---|---|---|
| **CapCut** | Edición manual rápida, subtítulos automáticos, plantillas, gratis | No hay API pública estable para automatizar | **Edición final manual** (10-15 min/video) — sigue siendo la mejor relación velocidad/calidad para 1 persona |
| **OpusClip** | Detecta "momentos virales" en videos largos y los recorta | Sí, API (plan Pro+) | Solo tiene sentido si grabas contenido *largo* (podcast/live) y quieres extraer clips. Si ya grabas en formato corto, no aporta |
| **Descript** | Edición por texto (borras palabras del transcript y corta el video), subtítulos, "Studio Sound" | API limitada/beta | Muy bueno si tu cuello de botella es cortar muletillas/silencios. Alternativa a CapCut para el paso manual |
| **VEED** | Subtítulos automáticos, resize multi-formato, marca de agua/branding consistente | Sí, API REST decente para subtítulos y render | **Automatizable**: quemar subtítulos + aplicar plantilla de marca por API |
| **Runway** | Generación/edición IA avanzada (b-roll, efectos) | Sí, API | Overkill para el MVP. Resérvalo para variantes que necesiten b-roll generado, no para el flujo diario |

**Recomendación concreta para el MVP:**
- **Automatizable por API ahora mismo:** subtítulos quemados + resize 9:16 + intro/outro de marca → **VEED API** o **Submagic** (alternativa más barata y enfocada 100% en subtítulos estilo TikTok, muy usada por creadores solos).
- **Semi-manual (queda con vos, 10-15 min):** selección del mejor corte del bruto, timing de cortes/jump cuts, elegir música — esto es exactamente donde el criterio humano todavía gana y automatizarlo mal te cuesta calidad percibida.
- **No automatizar en el MVP:** b-roll generado con IA, efectos avanzados — no mueve la aguja en resultado vs. esfuerzo de integración.

Flujo real: n8n descarga el bruto → llama a Submagic/VEED API para subtítulos+resize → sube el resultado a una carpeta `/PARA_REVISAR` en Drive → te llega alerta de Telegram "video listo para tu toque final" → vos lo bajas a CapCut 10 min, exportas a `/LISTO` → n8n detecta el archivo en `/LISTO` y sigue el flujo de publicación.

---

## 6. Publicación — comparación de vías

| Opción | Pros | Contras | Costo aprox./mes | Dificultad |
|---|---|---|---|---|
| **API directa (Meta Graph API + TikTok Content Posting API)** | Sin intermediario, control total, más barato a escala | TikTok API de publicación requiere app review y solo aprueba cuentas Business verificadas; Meta requiere Instagram Business + Facebook Page vinculada; mantenimiento de tokens | \$0 (solo dev time) | Alta |
| **Metricool** | Publica en IG+TikTok+más, tiene analítica integrada, buena API/Zapier/n8n community node, precios accesibles | Analítica de TikTok algo limitada vs. nativa | ~US\$18-45/mes | Media-baja |
| **Buffer** | Simple, confiable, buena UX | Publicación en TikTok más reciente/limitada, analítica básica | ~US\$6-12/mes por canal | Baja |
| **Later** | Fuerte en IG (calendario visual), bueno para planificar | TikTok más débil, plan barato limita cuentas | ~US\$25-40/mes | Baja |
| **Publer** | Muy buena relación precio/funciones, soporta IG+TikTok+auto-publish real (no solo recordatorio) | Comunidad/soporte más chico | ~US\$12-25/mes | Baja |
| **Make/n8n + APIs directas** | Máxima flexibilidad, todo en un solo orquestador | Hereda la dificultad de la API directa | Costo de n8n (\$0 self-host) | Alta |

**Recomendación MVP:** **Metricool** o **Publer** conectado vía su API/webhook a n8n. Justificación: ambos ya resolvieron el problema difícil (aprobación de apps ante Meta/TikTok, auto-publish real sin "recordatorio para publicar manual"), y exponen API/Zapier que n8n puede llamar con un nodo HTTP Request. Publer gana en precio si el presupuesto es ajustado; Metricool gana si querés que la MISMA herramienta te dé métricas (ver sección 7) y así reducís una integración.

**Camino de escalamiento:** una vez que el volumen justifique el costo de mantenimiento (>3 cuentas de cliente, o publicación multi-marca), migrar a API directa para bajar costo marginal por cuenta gestionada.

---

## 7. Métricas — recolección 24h/48h/72h/7d

**Flujo n8n:** un **Schedule Trigger** corre cada 6h. Por cada video en Airtable con `Estado=Publicado` y cuya `Fecha_Publicación` cae en una ventana pendiente (24h/48h/72h/7d desde publicación, con tolerancia de ±3h), dispara:
1. Llamada a la API de métricas (Metricool API si se usa esa vía, o Instagram Graph API `/insights` + TikTok Display API para reads).
2. Crea un registro nuevo en tabla `Métricas` (no pisa el anterior).
3. Si es la ventana de 7d, dispara el cálculo de Score_Rendimiento (sección 8).

**Qué métricas SÍ se consiguen por API de forma confiable:**
- Instagram Graph API (cuenta Business/Creator conectada a Página de FB): views, likes, comentarios, compartidos, guardados, alcance, seguidores ganados vía `insights` de la cuenta (no por post individual, hay que restar).
- TikTok: con cuenta de creador verificada y la Content Posting API/Display API se obtienen views, likes, comments, shares; **guardados y retención por segundo NO están expuestos de forma confiable en la API pública** — solo aparecen en el panel nativo TikTok Studio.

**Alternativas prácticas cuando la API no alcanza:**
- **Guardados de TikTok y retención detallada:** revisión manual 2x/semana en TikTok Studio (5 min), carga manual a Airtable vía un formulario simple (Airtable Form) que un nodo n8n también puede exponer.
- **Seguidores generados atribuibles a un video puntual:** es una métrica que ninguna plataforma da limpia. Aproximación práctica: snapshot de seguidores totales de la cuenta cada 24h (si el video es el único publicado ese día, el delta es la mejor proxy disponible).
- Documentar esto como limitación conocida del MVP, no como bug a resolver ahora.

---

## 8. Detección de ganadores — fórmula de Score de Rendimiento (0-100)

Se calcula a los 7 días (ventana estable), usando `Cuenta_Benchmark` como referencia.

```
Score_Rendimiento = 
    (Views_Index      × 30) +
    (Compartidos_Index × 20) +
    (Guardados_Index   × 20) +
    (Comentarios_Index × 15) +
    (Retención_Index   × 10) +
    (Seguidores_Index  × 5)

Donde cada *_Index = MIN( (métrica_video / métrica_promedio_cuenta) / 2 , 1 )
→ es decir: si el video hace 2x el promedio de la cuenta en esa métrica, el índice ya es 1 (máximo).
Esto evita que un solo video viral fuera de serie rompa la escala.

Si Retención no está disponible, se redistribuye su peso (10 pts) proporcionalmente
entre Guardados y Compartidos (que son los proxies más cercanos a "contenido que retiene").
```

**Clasificación resultante:**
- **80-100:** Ganador claro → dispara motor de variantes automáticamente.
- **60-79:** Prometedor → revisión manual, candidato a variante si hay tiempo.
- **40-59:** Promedio → no se toca, va a `Decisión=Repetir con ajustes` solo si el `Hook_Score` era bajo (indica que el problema fue el hook, no el tema).
- **<40:** Bajo rendimiento → `Decisión=Descartar` el ángulo, pero registrar el tema igual (a veces el tema es bueno y el formato falló).

Este umbral (≥70 dispara variantes automáticas, 40-69 revisión manual) es el que recomiendo dejar como constante configurable en un nodo n8n "Set" al inicio del flujo, para poder ajustarlo sin tocar el resto del flujo.

---

## 9. Motor de variantes

**Trigger:** Airtable Automation o n8n Schedule detecta `Score_Rendimiento ≥ 70` y `Estado=Medido`.

### Prompt del motor de variantes

```
SYSTEM:
Eres estratega de contenido. Un reel funcionó por encima del promedio de la cuenta.
Tu trabajo es generar variantes que exploten el mismo patrón ganador sin repetirlo
literalmente. Devuelves SIEMPRE JSON:

{
  "ideas_similares": ["10 ideas de video, mismo tema/formato ganador, distinto caso/ejemplo/dato"],
  "hooks_nuevos": ["5 hooks nuevos que abran distinto pero prometan lo mismo"],
  "guiones_derivados": [
    {"angulo": "string", "guion": "guion completo de 30-45s en formato hablado, con marcas [PAUSA]/[CORTE] donde corresponda"}
    // x3
  ],
  "angulos_distintos": ["3 formas de contar el mismo tema: ej. tutorial / historia personal / reacción a error común"],
  "captions_nuevos": ["3 captions, no reutilizar el original"],
  "cuando_republicar": "string: recomendación de timing (ej. 'en 5-7 días, no antes, para no canibalizar el algoritmo del original')"
}

USER:
Video ganador — Tema: {{tema}}, Hook: {{hook_principal}}, Categoría: {{categoria}}
Transcripción completa: """{{transcripcion}}"""
Score de rendimiento: {{score_rendimiento}}/100
Por qué crees que funcionó (usa las métricas): views {{multiplo_views}}x promedio,
compartidos {{multiplo_compartidos}}x, guardados {{multiplo_guardados}}x.
```

Output → nueva fila en tabla `Variantes_Generadas`, ligada a `Video_Padre`, Estado=`Por grabar`. Esto alimenta directamente el próximo bloque de grabación: cuando te sientas a grabar en lote, tu primera fuente de guiones es esta tabla, no la hoja en blanco.

---

## 10. Reporte automático semanal

**Trigger:** n8n Schedule, domingo 20:00.

**Lógica:** query a Airtable (todos los videos con `Fecha_Publicación` en los últimos 7 días + sus métricas) → arma un prompt de síntesis a Claude → genera reporte en Markdown → lo manda por email/WhatsApp y opcionalmente lo pega en una página de Notion/Airtable Interface.

```
SYSTEM: Eres analista de contenido. Con la tabla de videos y métricas de la semana,
generas un reporte breve y accionable (no un dashboard de vanity metrics):
1. Top 3 videos (score) y por qué funcionaron (1 línea cada uno).
2. Bottom 3 y el error más probable (hook débil / tema saturado / mala edición).
3. Temas ganadores de la semana (agrupando por categoría).
4. Formato/hook ganador (patrón común entre los top).
5. Errores detectados a nivel de proceso (ej. "3 videos se publicaron fuera del horario óptimo").
6. Qué grabar la próxima semana: 5 ideas concretas priorizando variantes de ganadores.
7. Calendario sugerido: qué día de la semana publicar cada una (según histórico de mejor horario).
```

---

## 11. Alertas

Vía **Telegram Bot** (más simple y gratis que WhatsApp Business API para uso personal) o **WhatsApp Cloud API** de Meta si ya tenés número Business configurado (Nexo.IA ya usa WhatsApp como canal, así que tiene sentido reusar esa infraestructura si se vende como servicio).

Eventos que disparan mensaje:
- ✅ "Video publicado: [tema] en [plataforma] a las [hora]".
- 🔥 "¡Ganador detectado! [tema] llegó a score [X]/100. Ya generé 10 variantes, revisalas en Airtable".
- 📝 "3 guiones nuevos listos para tu próxima grabación".
- 📊 "Resumen semanal listo" (con link al reporte).

Nodo n8n: **Telegram: Send Message** o **WhatsApp Business Cloud API (HTTP Request)** al final de cada sub-flujo relevante.

---

## 12. Stack tecnológico — comparación

| | **Opción A**: n8n + Drive + Airtable + OpenAI + Metricool | **Opción B**: Make + Drive + Sheets + Claude + Buffer | **Opción C**: n8n self-hosted + Supabase + OpenAI/Claude + APIs oficiales |
|---|---|---|---|
| Velocidad de arranque | Alta — nodos nativos para todo | Alta — Make tiene UX más simple aún | Baja — hay que programar backend |
| Costo mensual inicial | ~US\$50-90 | ~US\$40-70 | ~US\$20-40 (infra) + tiempo dev |
| Techo de escalabilidad | Medio-alto (Airtable limita filas en plan bajo) | Medio (Sheets colapsa con volumen/relaciones) | Alto (Postgres real, sin límites de filas) |
| Dificultad técnica | Media | Baja | Alta |
| Ideal para | **Empezar rápido y validar el MVP en 1-2 semanas** | Empezar aún más rápido, pero migrarás pronto | **Escalar a multi-cliente (servicio vendible)** |

**Recomendación:** arrancar con **Opción A** para validar en tu propia marca. Si el sistema funciona y decidís venderlo como servicio a 5+ clientes, migrar el backend a **Opción C** (Supabase reemplaza Airtable como base de datos multi-tenant, n8n self-hosted baja el costo marginal por cliente) manteniendo la misma lógica de flujos ya probada. No migres antes de validar — es la trampa más común de sobre-ingeniería en MVPs.

---

## 13. Roadmap de 30 días

### Semana 1 — Fundaciones (sin IA todavía)
- Crear estructura de carpetas en Drive (`/RAW`, `/PARA_REVISAR`, `/LISTO`, `/PUBLICADO`).
- Construir las 4 tablas en Airtable con todos los campos.
- Conectar cuenta de OpenAI/Claude (API keys) y n8n (cloud o self-host en un VPS barato).
- Flujo 1: Drive Trigger → Airtable Create Record. Probar con 3 videos dummy.
- Grabar el primer lote real (10-15 videos brutos).

### Semana 2 — Cerebro de contenido
- Flujo 2: Transcripción (Whisper) + prompt de análisis → Airtable Update.
- Flujo 3: Prompt de generación de assets (captions/hooks/hashtags) → Airtable Update.
- Revisar manualmente calidad de los outputs de IA sobre los 10-15 videos reales, ajustar prompts.
- Definir manualmente (todavía) el `Cuenta_Benchmark` con datos históricos de tu cuenta actual.

### Semana 3 — Edición + publicación
- Contratar/activar Submagic o VEED API para subtítulos automáticos.
- Flujo 4: video transcrito+con assets → llamada a API de subtítulos → sube a `/PARA_REVISAR` → alerta Telegram.
- Tu edición manual final (CapCut) → subida a `/LISTO`.
- Conectar Metricool/Publer, flujo 5: `/LISTO` → auto-publish programado según calendario.
- Publicar los primeros 5-7 reels 100% vía el sistema.

### Semana 4 — Métricas, scoring y cierre del loop
- Flujo 6: pull de métricas 24/48/72h/7d.
- Implementar fórmula de Score_Rendimiento en Airtable (fórmula nativa o nodo n8n Function).
- Flujo 7: motor de variantes disparado por score ≥70.
- Flujo 8: reporte semanal + alertas.
- Retro: revisar qué pasos siguen siendo 100% manuales y decidir cuáles automatizar en el mes 2.

---

## 14. Prompts, fórmulas y checklist — resumen ejecutable

*(Los prompts completos están en las secciones 3, 4 y 9. Fórmulas completas en la sección 8.)*

### Checklist de implementación
- [ ] Carpetas Drive creadas y compartidas con la cuenta de servicio de n8n
- [ ] 4 tablas Airtable con campos exactos de la sección 2
- [ ] API keys: OpenAI/Claude, Metricool o Publer, Telegram Bot
- [ ] n8n: credenciales conectadas (Drive, Airtable, OpenAI, HTTP genérico)
- [ ] Flujo 1 (ingesta) probado end-to-end
- [ ] Flujo 2-3 (análisis + assets) probado con datos reales, prompts ajustados
- [ ] Cuenta de Instagram Business + TikTok Creator vinculadas en Metricool/Publer
- [ ] Flujo 4-5 (edición asistida + publicación) probado con 1 video real
- [ ] `Cuenta_Benchmark` inicial cargado
- [ ] Flujo 6 (métricas) probado, con fallback manual documentado para guardados TikTok
- [ ] Fórmula Score_Rendimiento validada contra 5 videos históricos (sanity check)
- [ ] Flujo 7 (motor de variantes) probado con 1 "ganador" simulado
- [ ] Flujo 8 (reporte + alertas) recibido correctamente en Telegram/WhatsApp/email

### Costos mensuales estimados (MVP, 1 cuenta)
| Ítem | Costo/mes |
|---|---|
| n8n (Cloud Starter) o VPS self-host | US\$0-24 |
| Airtable (plan Team, si supera el free) | US\$0-20 |
| OpenAI/Claude API (transcripción + prompts, ~30 videos/mes) | US\$15-30 |
| Metricool o Publer | US\$12-45 |
| Submagic/VEED (subtítulos) | US\$15-30 |
| Telegram Bot | US\$0 |
| **Total** | **~US\$45-150/mes** |

### Riesgos y limitaciones (decirlas de frente, no esconderlas)
1. **TikTok no expone guardados ni retención por API pública** → dato manual, 2x/semana.
2. **Meta/TikTok pueden cambiar términos de API de publicación** sin aviso → por eso conviene la capa intermedia (Metricool/Publer) que absorbe ese riesgo por vos.
3. **"Seguidores generados por video" es una proxy, no un dato exacto** → documentarlo como estimación.
4. **La calidad de la edición semi-manual depende de que vos sigas revisando** — el sistema no reemplaza criterio editorial, lo alimenta.
5. **Rate limits de la API de IA** si el volumen crece mucho (poco probable en MVP de 1 cuenta).
6. **Dependencia de una sola persona grabando** — el sistema resuelve organización/distribución, no resuelve que sigas necesitando grabar en lote.

### MVP vs. versión avanzada
| | MVP (mes 1) | Avanzada (mes 3+) |
|---|---|---|
| Edición | Semi-manual (subtítulos auto + corte manual) | Auto-selección de mejor clip con IA (Opus/Descript API) |
| Publicación | Metricool/Publer | API directa Meta+TikTok (si escala a multi-cliente) |
| Base de datos | Airtable | Supabase (Postgres) multi-tenant |
| Variantes | Se generan, vos decidís cuáles grabar | Ranking automático de qué variante grabar primero según benchmark de nicho |
| Reporte | Semanal, texto | Dashboard interactivo (Airtable Interface o app propia) |
| Alcance | 1 cuenta (la tuya) | Multi-cliente, whitelabel |

---

## 15. Enfoque de negocio — venderlo como servicio

### Nombre comercial
**"Piloto de Reels" by Nexo.IA** (o "Reels en Piloto Automático") — coherente con el posicionamiento actual de Nexo.IA ("diagnóstico primero, automatización real, atención directa de Evelin Hernández").

### Problema que resuelve
Marcas personales y pymes con dueño/a visible (coaches, profesionales de servicios, fundadores) saben que necesitan publicar contenido corto todos los días para crecer, pero **no tienen sistema**: dependen de la motivación diaria, no miden qué funciona, y cuando algo pega no saben replicarlo. El resultado es contenido inconsistente y cero aprendizaje acumulado.

### Cliente ideal
- Emprendedor/a o profesional con marca personal ya en marcha (no desde cero).
- Graba contenido pero publica de forma irregular (menos de 3x/semana).
- Ya tiene algo de tracción (para que el `Cuenta_Benchmark` tenga sentido) pero no tiene tiempo/equipo para editar, medir y planificar.
- Factura lo suficiente para justificar US\$150-400/mes en un sistema (coaches, consultores, clínicas con doctor/a como cara visible, agencias chicas).

### Pricing sugerido
- **Setup (una vez):** US\$400-800 (CLP ~380.000-760.000 aprox.) — incluye configuración completa de Airtable, n8n, prompts calibrados al nicho del cliente, conexión de cuentas y primer lote de 10 videos procesados.
- **Mensual:** US\$150-350/mes según volumen (planes: Básico 12 reels/mes ~US\$150, Pro 20 reels/mes + reporte semanal + motor de variantes ~US\$280, incluye costos de API/herramientas).
- **Costos aproximados por cliente:** US\$45-100/mes (según tabla de sección 14, escalado con volumen).
- **Margen estimado:** 60-75% en el plan mensual una vez amortizado el setup; el setup en sí deja margen alto porque es principalmente tiempo, no costo variable.

### Qué se entrega al cliente
1. Sistema configurado y funcionando (Airtable + n8n conectados a sus cuentas).
2. Acceso a su propio Airtable (transparencia: ven cada video, score, decisión).
3. Publicación diaria/según plan, sin que el cliente toque nada más que grabar y aprobar caption si quiere.
4. Reporte semanal por WhatsApp/email.
5. Motor de variantes: guiones listos para el próximo lote de grabación.

### Garantía comercial
Modelo "diagnóstico primero" ya usado por Nexo.IA: primeras 2 semanas con seguimiento cercano y ajuste de prompts/hooks sin costo extra si el cliente no está viendo consistencia de publicación (no se garantiza viralidad — eso sería una promesa falsa — se garantiza el sistema funcionando: publicación consistente + medición real).

### Cómo venderlo por WhatsApp
Guion corto, directo, en el tono ya usado por Nexo.IA (diagnóstico, no venta agresiva):

```
Hola [nombre] 👋 Soy Evelin de Nexo.IA.

Vi que subís contenido a Instagram/TikTok pero de forma bastante irregular
¿verdad? Te cuento algo rápido: armamos un sistema que toma tus videos en
bruto (los grabás en lote un día) y se encarga de todo lo demás — transcribe,
te arma captions y hashtags, edita subtítulos, publica en el horario óptimo,
mide resultados y cuando un video pega fuerte te genera automáticamente
variantes para repetir el patrón ganador.

Vos seguís siendo la cara de la marca — el sistema se encarga de que nunca
más dependa de que tengas ganas ese día de editar y subir.

¿Te interesa que te haga un diagnóstico rápido y gratis de cómo se vería
aplicado a tu cuenta? Te muestro con tus propios últimos 5 videos qué score
sacarían y qué cambiaría.
```

Cierre natural: el "diagnóstico gratis con sus propios videos" es el gancho — reutiliza el análisis de la sección 3 como demo de venta (corré el flujo de análisis sobre 3-5 videos públicos del prospecto y mandale el resultado en un PDF/mensaje antes de cobrar nada).
