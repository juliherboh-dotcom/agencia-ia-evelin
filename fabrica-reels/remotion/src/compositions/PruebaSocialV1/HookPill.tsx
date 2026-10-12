import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";

/**
 * Este template NO usa un HookHeadline grande como personal_brand_clean
 * (el formato split-screen en sí mismo es el hook: ver
 * sistema-reels-autopilot.md, sección 2). El campo `hook` sigue siendo
 * parte del contrato por consistencia con el resto del sistema, pero acá
 * se muestra chico, arriba del panel inferior, en vez de ocupar media
 * pantalla.
 */
export const HookPill: React.FC<{
  hook: EditSpec["hook"];
  accentColor: string;
  top: number;
}> = ({ hook, accentColor, top }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({ frame, fps, config: { damping: 14, mass: 0.6 }, durationInFrames: 10 });

  const emphasisSet = new Set(hook.emphasis_words.map((w) => w.toLowerCase()));
  const words = hook.text.split(" ");

  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 56,
        right: 56,
        textAlign: "center",
        opacity: entrance,
        transform: `translateY(${(1 - entrance) * 10}px)`,
      }}
    >
      <span
        style={{
          fontFamily: "Manrope, Arial, sans-serif",
          fontSize: 30,
          fontWeight: 800,
          lineHeight: 1.15,
          color: "#FFFFFF",
          WebkitTextStroke: "4px rgba(0,0,0,0.5)",
          paintOrder: "stroke fill",
        }}
      >
        {words.map((word, i) => {
          const clean = word.toLowerCase().replace(/[.,!?]/g, "");
          const isEmphasis = emphasisSet.has(clean);
          return (
            <span key={i} style={{ color: isEmphasis ? accentColor : "#FFFFFF" }}>
              {word}{" "}
            </span>
          );
        })}
      </span>
    </div>
  );
};
