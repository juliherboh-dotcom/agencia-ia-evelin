import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";

// Tamaño de letra inversamente proporcional al largo del texto: palabras
// cortas y punchy (ej. "RPA") se ven GRANDES como en los reels de
// referencia, en vez de siempre el mismo tamaño fijo sin importar el
// contenido -- pedido explícito: "juegan mucho con los tamaños".
function fontSizeFor(text: string): number {
  const len = text.length;
  if (len <= 4) return 118;
  if (len <= 7) return 100;
  if (len <= 11) return 86;
  return 72;
}

export const BigTitleCard: React.FC<{
  line1: string;
  line2?: string;
  accentColor: string;
  position: { x: number; y: number };
  canvasWidth: number;
  canvasHeight: number;
  durationInFrames?: number;
}> = ({ line1, line2, accentColor, position, canvasWidth, canvasHeight, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Dirección de entrada según en qué mitad del canvas cae el overlay --
  // si no vienen siempre desde el mismo lado, se siente más editado a mano.
  const fromLeft = position.x < 0.5;
  const fromTop = position.y < 0.5;

  const enter = spring({ frame, fps, config: { damping: 9, stiffness: 170 }, durationInFrames: 12 });
  const slideX = (1 - enter) * (fromLeft ? -70 : 70);
  const slideY = (1 - enter) * (fromTop ? -40 : 40);
  const scaleIn = 0.55 + enter * 0.45;

  // Salida: si conocemos cuánto dura, se achica y se desvanece en vez de
  // cortar en seco -- más vivo que un corte abrupto.
  const exit =
    durationInFrames !== undefined
      ? Math.min(1, Math.max(0, (durationInFrames - frame) / 8))
      : 1;

  // Bamboleo continuo + rotación sutil una vez que ya entró.
  const bob = Math.sin(frame / 15) * 6;
  const wobble = Math.sin(frame / 22) * 1.6;

  const size1 = fontSizeFor(line1);
  const size2 = line2 ? fontSizeFor(line2) : size1;

  const left = position.x * canvasWidth;
  const top = position.y * canvasHeight;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        transform: `translate(-50%, -50%) translate(${slideX}px, ${slideY + bob}px) rotate(${wobble}deg) scale(${scaleIn * exit})`,
        opacity: enter * exit,
        textAlign: "center",
        fontFamily: "Inter Display, Inter, Arial, sans-serif",
        fontWeight: 900,
        lineHeight: 0.95,
        textTransform: "uppercase",
      }}
    >
      <div
        style={{
          fontSize: size1,
          color: "#FFFFFF",
          WebkitTextStroke: "3px rgba(0,0,0,0.5)",
          paintOrder: "stroke fill",
        }}
      >
        {line1}
      </div>
      {line2 && (
        <div
          style={{
            fontSize: size2,
            color: accentColor,
            WebkitTextStroke: "3px rgba(0,0,0,0.5)",
            paintOrder: "stroke fill",
          }}
        >
          {line2}
        </div>
      )}
    </div>
  );
};
