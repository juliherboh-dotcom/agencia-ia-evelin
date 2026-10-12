import React from "react";

const LABEL_STYLE: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  textAlign: "center",
  fontFamily: "Manrope, Arial, sans-serif",
  fontSize: 34,
  fontWeight: 800,
  color: "#FFFFFF",
  WebkitTextStroke: "3px rgba(0,0,0,0.4)",
  paintOrder: "stroke fill",
};

export const CompareTopLabel: React.FC<{ text: string; top: number }> = ({ text, top }) => (
  <div style={{ ...LABEL_STYLE, top }}>{text}</div>
);

/**
 * Label del panel inferior, en dos colores: el prefijo ("Editado por") en
 * blanco y el nombre de la herramienta en el color de acento -- igual que
 * el reel de referencia (ver sistema-reels-autopilot.md, sección 2).
 */
export const CompareBottomLabel: React.FC<{
  prefix: string;
  highlight: string;
  accentColor: string;
  top: number;
}> = ({ prefix, highlight, accentColor, top }) => (
  <div style={{ ...LABEL_STYLE, top }}>
    {prefix} <span style={{ color: accentColor }}>{highlight}</span>
  </div>
);
