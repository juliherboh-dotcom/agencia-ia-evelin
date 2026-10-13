import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

const BAR_COUNT = 48;

// Alturas pseudo-random fijas por barra (seedeadas por índice, no por
// Math.random() en cada frame) para que el waveform tenga una forma
// estable en vez de titilar frame a frame.
function pseudoHeight(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Barra de progreso estilo waveform de audio, pegada abajo -- reemplaza la
 * línea sólida arriba que se sentía "plana" comparada con el recurso del
 * video de referencia (barras de audio animadas abajo de la pantalla).
 */
export const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = Math.min(frame / Math.max(durationInFrames - 1, 1), 1);
  const playedBars = Math.floor(progress * BAR_COUNT);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 28,
        left: 24,
        right: 24,
        height: 36,
        display: "flex",
        alignItems: "flex-end",
        gap: 4,
      }}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const base = 0.25 + pseudoHeight(i) * 0.75;
        const wobble = Math.sin(frame / 9 + i * 1.7) * 0.12;
        const heightFraction = Math.max(0.12, Math.min(1, base + wobble));
        const isPlayed = i <= playedBars;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${heightFraction * 100}%`,
              borderRadius: 3,
              backgroundColor: isPlayed ? color : "rgba(255,255,255,0.25)",
              transition: "background-color 0.1s linear",
            }}
          />
        );
      })}
    </div>
  );
};
