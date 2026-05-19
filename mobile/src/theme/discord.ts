import { Theme } from "./types";

export const discordTheme: Theme = {
  id: "discord",
  colors: {
    bg: "#36393f",
    bgElev: "#2f3136",
    bgElevH: "#3a3d44",
    bgInput: "#40444b",
    border: "rgba(255,255,255,0.06)",
    borderStrong: "rgba(255,255,255,0.12)",
    ink: "#dcddde",
    inkDim: "#b9bbbe",
    inkMuted: "#72767d",
    accent: "#5865f2",
    accentText: "#ffffff",
    amber: "#faa61a",
    danger: "#ed4245",
    online: "#3ba55d",
    bubbleMine: "#5865f2",
    bubbleMineText: "#ffffff",
    bubbleOther: "#2f3136",
    bubbleOtherText: "#dcddde",
  },
  fonts: {
    body: "Inter_400Regular",
    mono: "Inter_500Medium",
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    bubble: 16,
  },
  scanlines: false,
  decorate: false,
};
