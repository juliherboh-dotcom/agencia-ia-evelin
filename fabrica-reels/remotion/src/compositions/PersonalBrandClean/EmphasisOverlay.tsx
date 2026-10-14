import React from "react";
import { Img, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Overlay } from "../../../../schema/edit-spec.zod";
import { secondsToFrames } from "../../utils/time";
import { NotificationMockup } from "./NotificationMockup";
import { ChecklistMockup } from "./ChecklistMockup";
import { BigTitleCard } from "./BigTitleCard";
import { StatNumberCard } from "./StatNumberCard";

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
  // Bamboleo continuo sutil una vez que ya entró, para que el recurso se
  // sienta vivo en vez de una pegatina estática (pedido explícito de
  // Evelin: "podria tener movimiento").
  const bob = Math.sin(frame / 15) * 5;

  const left = overlay.position.x * width;
  const top = overlay.position.y * height;

  if (overlay.type === "text") {
    return (
      <div
        style={{
          position: "absolute",
          left,
          top,
          transform: `translate(-50%, -50%) translateY(${bob}px) scale(${entrance})`,
          backgroundColor: accentColor,
          color: "#111111",
          fontWeight: 800,
          fontFamily: "Inter, Arial, sans-serif",
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
          transform: `translate(-50%, -50%) translateY(${bob}px) scale(${entrance})`,
        }}
      />
    );
  }

  if (overlay.type === "notification" && overlay.notification_title) {
    return (
      <NotificationMockup
        icon={overlay.notification_icon}
        title={overlay.notification_title}
        subtitle={overlay.notification_subtitle}
        width={overlay.width}
        canvasWidth={width}
        accentColor={accentColor}
      />
    );
  }

  if (overlay.type === "checklist" && overlay.checklist_items) {
    return (
      <ChecklistMockup
        title={overlay.checklist_title}
        items={overlay.checklist_items}
        width={overlay.width}
        canvasWidth={width}
        accentColor={accentColor}
      />
    );
  }

  if (overlay.type === "big_title" && overlay.title_line1) {
    return <BigTitleCard line1={overlay.title_line1} line2={overlay.title_line2} accentColor={accentColor} />;
  }

  if (overlay.type === "stat_number" && overlay.stat_number) {
    return <StatNumberCard value={overlay.stat_number} caption={overlay.stat_caption} accentColor={accentColor} />;
  }

  // type === "badge" u otro caso sin contenido: no renderiza nada (placeholder
  // seguro en vez de romper el render por un overlay mal formado).
  return null;
};
