import React from "react";
import { Img, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Overlay } from "../../../../schema/edit-spec.zod";
import { secondsToFrames } from "../../utils/time";

// Default cuando el overlay no manda `width`: pensado para un
// sticker/ícono chico (140px sobre 1080 de ancho). Para mockups grandes
// (diagramas, tarjetas con texto -- ver sistema-reels-autopilot.md y el
// análisis del video de referencia de Evelin), el edit_spec debe mandar
// `width` explícito (fracción 0-1 del canvas).
const DEFAULT_IMAGE_OVERLAY_WIDTH_PX = 140;

export const EmphasisOverlay: React.FC<{
  overlay: Overlay;
  width: number;
  height: number;
  accentColor: string;
}> = ({ overlay, width, height, accentColor }) => {
  const { fps } = useVideoConfig();
  const from = secondsToFrames(overlay.start, fps);
  const duration = secondsToFrames(overlay.end - overlay.start, fps);

  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <OverlayContent overlay={overlay} width={width} height={height} accentColor={accentColor} />
    </Sequence>
  );
};

const OverlayContent: React.FC<{
  overlay: Overlay;
  width: number;
  height: number;
  accentColor: string;
}> = ({ overlay, width, height, accentColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 10 }, durationInFrames: 10 });

  const left = overlay.position.x * width;
  const top = overlay.position.y * height;

  if (overlay.type === "text") {
    return (
      <div
        style={{
          position: "absolute",
          left,
          top,
          transform: `translate(-50%, -50%) scale(${entrance})`,
          backgroundColor: accentColor,
          color: "#111111",
          fontWeight: 800,
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: 32,
          padding: "10px 20px",
          borderRadius: 999,
          whiteSpace: "nowrap",
        }}
      >
        {overlay.text}
      </div>
    );
  }

  if (overlay.type === "image" && overlay.image_url) {
    const imageWidth = overlay.width !== undefined ? overlay.width * width : DEFAULT_IMAGE_OVERLAY_WIDTH_PX;
    return (
      <Img
        src={overlay.image_url}
        style={{
          position: "absolute",
          left,
          top,
          width: imageWidth,
          transform: `translate(-50%, -50%) scale(${entrance})`,
        }}
      />
    );
  }

  // type === "badge" u otro caso sin contenido: no renderiza nada (placeholder
  // seguro en vez de romper el render por un overlay mal formado).
  return null;
};
