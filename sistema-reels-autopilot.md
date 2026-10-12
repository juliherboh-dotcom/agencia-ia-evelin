# Sistema de reels autopilot — plantilla "Editado por IA" (Nexo.IA)

Plantilla reutilizable sacada de analizar frame a frame y transcript completo el reel de referencia [@estebanperez.ia](https://www.instagram.com/reel/DeFEiWhgHP1/) (204K reproducciones, 9.743 comentarios). El formato funciona porque el gancho es el propio proceso de edición con IA, no el contenido de fondo — encaja directo con lo que vende Nexo.IA.

## 1. Qué es el formato

Video split-screen vertical (9:16) que compara un clip crudo contra "la misma toma editada por IA", pero en vez de mostrar solo el resultado final, va revelando en el panel de abajo una secuencia de mockups de UI (chat, timeline de edición, notificación) que dramatizan el proceso. El mensaje de fondo: "no edité yo, lo editó la IA con un prompt, sentado en el sillón".

**Por qué funciona:**
- El hook es ambiguo a propósito (al segundo 0 los dos paneles son idénticos → curiosidad: "¿dónde está la diferencia?").
- Es demostración, no promesa — el espectador ve "la prueba" en pantalla.
- El CTA pide un comentario con palabra clave (no un link ni un DM directo), lo que dispara el algoritmo de IG por volumen de comentarios y después convierte ese comentario en una conversación de DM automatizada.

## 2. Estructura visual (plantilla de timing)

Reel de referencia: 20.8s. Extrapolable a 15–30s.

| Tiempo | Panel superior ("Original") | Panel inferior ("Editado por [HERRAMIENTA]") |
|---|---|---|
| 0s | Clip crudo, etiqueta tipo timecode: `NOMBRE_ARCHIVO.MOV · SIN TOCAR` | Idéntico al original (sin diferencia visible todavía — genera el "¿y la edición?") |
| ~25% del video | Clip crudo sigue igual | Aparece un contador/stat falso (ej. "99 → lo edité 100") simulando iteración de la IA |
| ~50% del video | Clip crudo sigue igual | Mockup de chat/app con el prompt real escrito: burbuja de mensaje + ícono de enviar, mostrando la instrucción que se le dio a la IA |
| ~75% del video | Clip crudo sigue igual | Mockup de timeline de edición (tracks: guion / subtítulos / animación / música / efectos) con scrubber avanzando + contadores de likes/vistas/comentarios subiendo en vivo a un costado |
| Últimos ~3-5s (cierre) | Clip crudo sigue igual | Mockup de notificación/DM: archivo adjunto tipo `prompt-editor.txt` + burbuja con la palabra clave del CTA (ej. "DISEÑO ♥") y flecha de enviar |

**Constantes visuales en todo el video:**
- Fondo negro, los dos clips como tarjetas con esquinas redondeadas y sombra.
- Etiquetas fijas arriba de cada panel: `Original` (blanco) / `Editado por [Herramienta]` (nombre de la herramienta en color de marca — dorado/ámbar en el original).
- Subtítulos palabra por palabra sincronizados con el audio, abajo del panel inferior únicamente (el panel "Original" nunca lleva subtítulos — refuerza que es "sin tocar").
- El clip de arriba y el de abajo son el mismo metraje corriendo en paralelo, sin cortes entre sí — lo único que cambia es lo que se superpone abajo.

## 3. Guion tipo (adaptable)

Habla a cámara, tono casual, 1 sola toma sin cortes visibles (los "cortes" los simula el overlay, no el video real). Estructura del guion de referencia:

1. Gancho: nombrar la herramienta + afirmación fuerte ("[Herramienta] acaba de dejar sin trabajo a los editores de video").
2. Prueba social del esfuerzo cero: "lo único que tuve que hacer fue sentarme y pedirle que..." + lista rápida de lo que hizo la IA (subtítulos, efectos de sonido, música, sin abrir ningún programa de edición).
3. CTA: "comentá [PALABRA CLAVE] si querés que te mande el prompt que usé".

Caption (fuera de cámara, acompaña el post):
- Repite el CTA de la palabra clave arriba de todo (primera línea = lo que más se lee).
- Explica en 2-3 líneas qué hizo la IA específicamente (cortó silencios, siguió la cara, subtítulos palabra a palabra, animaciones, música, efectos).
- Cierra con "Guárdalo para tu próximo video" (dispara guardados, otra señal que favorece el algoritmo).
- Hashtags de nicho, no genéricos (la herramienta + la categoría, no #reels #viral).

## 4. Prompt de edición a usar con Claude (reconstrucción)

Para reproducir el resultado del panel "Editado por IA" con Claude (Opus 5.5 u otro modelo con capacidad de edición de video), el prompt debería pedir explícitamente cada una de estas piezas — es lo que el propio reel dice que hizo la IA:

```
Edita este video crudo como un reel vertical 9:16 de redes sociales:
1. Corta los silencios y las pausas muertas entre frases.
2. Mantén el encuadre siguiendo mi cara/cuerpo en todo momento (recorte dinámico si hace falta).
3. Agrega subtítulos animados palabra por palabra, sincronizados con mi voz, en un estilo
   legible (fuente bold, alto contraste, aparecen y desaparecen con el ritmo del habla).
4. Suma efectos de sonido sutiles en los cortes y remates (whoosh, pop) y una pista de
   música de fondo que no tape la voz.
5. Agrega animaciones de texto/gráficos para resaltar los puntos clave que menciono en voz.
6. Entrega el video final listo para publicar, sin que yo tenga que abrir ningún editor.
```

**Nota:** esto reproduce el panel "Editado por IA" en su versión real (subtítulos, cortes, música, efectos). Los mockups de UI (chat, timeline, contador, notificación) que aparecen DENTRO del panel inferior son gráficos de motion design agregados aparte — no los genera la edición de video en sí, son overlays armados en una herramienta de diseño/motion (After Effects, CapCut, Canva, etc.) superpuestos sobre el clip ya editado, para dramatizar visualmente "la IA trabajando".

## 5. Cómo aplicarlo a Nexo.IA

Variantes directas para el banco de ideas de contenido:

- **Versión "herramienta real que usamos"**: mismo formato, pero con una automatización real de un cliente (ej. cotización por WhatsApp) en vez de edición de video — panel de arriba "antes" (proceso manual), panel de abajo "con el agente de Nexo.IA", con mockups de: el flujo armado en n8n, el mensaje de WhatsApp respondido solo, el reporte generado.
- **Palabra clave de CTA propia**: elegir una palabra corta y única por campaña (como "DISEÑO" en el original) para poder medir qué pieza de contenido generó qué volumen de leads por comentario.
- **Reutilizar el mismo clip base varias veces**: como el panel "Original" no cambia, se puede grabar una sola toma de 20-30s y producir múltiples versiones del panel inferior (distintas herramientas, distintos procesos) sin volver a filmar.

## 6. Checklist de producción

- [ ] 1 toma cruda de 15-30s, encuadre fijo o semi-fijo, buena luz, sin cortes.
- [ ] Guion corto con gancho + prueba + CTA de palabra clave (ver sección 3).
- [ ] Edición base del panel inferior con el prompt de la sección 4.
- [ ] Overlays de motion design: contador, mockup de chat/prompt, mockup de proceso/timeline, mockup de notificación con CTA.
- [ ] Subtítulos palabra por palabra solo en el panel inferior.
- [ ] Caption con el CTA en la primera línea + explicación corta + "guárdalo" + hashtags de nicho.
- [ ] Automatización de DM: respuesta automática al comentario con la palabra clave, que entregue el recurso prometido (prompt, plantilla, etc.) y abra conversación de venta.
