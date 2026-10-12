/**
 * Convierte decibeles al multiplicador lineal de volumen que esperan las
 * props `volume` de Remotion (`<Audio volume={...} />`, `<OffthreadVideo
 * volume={...} />`): 0 = silencio, 1 = volumen original, >1 amplifica.
 * 0dB -> 1, -6dB -> ~0.5, -20dB -> 0.1.
 */
export function dbToLinearVolume(db: number): number {
  return Math.pow(10, db / 20);
}
