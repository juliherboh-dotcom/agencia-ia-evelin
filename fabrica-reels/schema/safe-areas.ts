/**
 * Zonas seguras (safe areas) de TikTok e Instagram Reels: fracciones del
 * canvas 1080x1920 que la UI nativa de cada app tapa con sus propios
 * elementos (barra superior, caption/username/sonido/botones abajo,
 * columna de like/comment/share/guardar a la derecha).
 *
 * Cualquier overlay, subtítulo o elemento de marca que el sistema genere
 * debe caer DENTRO del área que estas fracciones dejan libre. Los valores
 * son aproximaciones razonables basadas en los layouts públicos de ambas
 * apps a 2026; conviene revisarlos si alguna de las dos rediseña su UI.
 */

export type Platform = "tiktok" | "instagram_reels";

export const SAFE_AREA_PROFILES: Record<
  Platform,
  { top: number; bottom: number; right: number }
> = {
  tiktok: { top: 0.12, bottom: 0.2, right: 0.15 },
  instagram_reels: { top: 0.1, bottom: 0.22, right: 0.14 },
};

/** Posición Y aproximada (fracción 0-1) de cada valor categórico usado en subtitles.style.position. */
export const SUBTITLE_POSITION_Y: Record<"top" | "center" | "bottom", number> = {
  top: 0.16,
  center: 0.5,
  // Deliberadamente por ENCIMA del borde inferior real (0.94-0.98): a esa
  // altura el subtítulo queda tapado por caption/username/botones nativos.
  bottom: 0.78,
};

export function isWithinSafeArea(
  position: { x: number; y: number },
  platform: Platform
): boolean {
  const area = SAFE_AREA_PROFILES[platform];
  const withinX = position.x <= 1 - area.right;
  const withinY = position.y >= area.top && position.y <= 1 - area.bottom;
  return withinX && withinY;
}
