import React from "react";
import { Img } from "remotion";
import type { EditSpec } from "../../../../schema/edit-spec.zod";

type WatermarkPosition = EditSpec["branding"]["watermark_position"];

const POSITION_STYLE: Record<WatermarkPosition, React.CSSProperties> = {
  top_left: { top: 48, left: 32 },
  top_right: { top: 48, right: 32 },
  bottom_left: { bottom: 64, left: 32 },
  bottom_right: { bottom: 64, right: 32 },
};

export const LogoWatermark: React.FC<{
  logoUrl: string;
  position: WatermarkPosition;
}> = ({ logoUrl, position }) => (
  <Img
    src={logoUrl}
    style={{
      position: "absolute",
      width: 72,
      height: 72,
      borderRadius: 16,
      opacity: 0.85,
      objectFit: "contain",
      ...POSITION_STYLE[position],
    }}
  />
);
