export type ThemeId = "neo" | "discord";

export interface ThemeFonts {
  body: string;
  mono: string;
}

export interface ThemeColors {
  bg: string;
  bgElev: string;
  bgElevH: string;
  bgInput: string;
  border: string;
  borderStrong: string;
  ink: string;
  inkDim: string;
  inkMuted: string;
  accent: string;
  accentText: string;
  amber: string;
  danger: string;
  online: string;
  bubbleMine: string;
  bubbleMineText: string;
  bubbleOther: string;
  bubbleOtherText: string;
}

export interface Theme {
  id: ThemeId;
  colors: ThemeColors;
  fonts: ThemeFonts;
  radius: {
    sm: number;
    md: number;
    lg: number;
    bubble: number;
  };
  scanlines: boolean;
  decorate: boolean;
}
