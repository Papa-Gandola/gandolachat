import { Theme } from "./types";

export const neoTheme: Theme = {
  id: "neo",
  colors: {
    bg: "#0a0a0a",
    bgElev: "#131313",
    bgElevH: "#1a1a1d",
    bgInput: "#0f0f10",
    border: "rgba(255,255,255,0.06)",
    borderStrong: "rgba(255,255,255,0.12)",
    ink: "#e8e6df",
    inkDim: "#a09c91",
    inkMuted: "#666666",
    accent: "#c6ff3d",
    accentText: "#0a0a0a",
    amber: "#ffb84d",
    danger: "#ff5a5f",
    online: "#c6ff3d",
    bubbleMine: "#c6ff3d",
    bubbleMineText: "#0a0a0a",
    bubbleOther: "#131313",
    bubbleOtherText: "#e8e6df",
  },
  fonts: {
    body: "Inter_400Regular",
    mono: "JetBrainsMono_500Medium",
  },
  radius: {
    sm: 0,
    md: 0,
    lg: 0,
    bubble: 14,
  },
  scanlines: true,
  decorate: true,
};
