import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path } from "react-native-svg";

import { useTheme } from "../theme";

// Хеллоуин в Гандолиуме (октябрь, /me.theme === "halloween"): паутина в
// верхних углах и паучок на нити поверх шапки, мимо касаний. Та же
// геометрия, что у десктопа (HalloweenDecor.tsx): нити из угла + провисающие
// кольца quadratic-кривыми. react-native-svg в сборке есть — едет по OTA.

function cobwebPaths(size: number, corner: "left" | "right"): string[] {
  const strands = 7;
  const rings = 5;
  const cx = corner === "left" ? 0 : size;
  const cy = 0;
  const angles: number[] = [];
  const out: string[] = [];
  for (let i = 0; i < strands; i++) {
    const t = i / (strands - 1);
    const ang = corner === "left" ? (t * Math.PI) / 2 : Math.PI / 2 + (t * Math.PI) / 2;
    const jitter = 0.97 + 0.06 * Math.sin(i * 12.9898);
    out.push(`M${cx} ${cy} L${(cx + Math.cos(ang) * size * jitter).toFixed(1)} ${(cy + Math.sin(ang) * size * jitter).toFixed(1)}`);
    angles.push(ang);
  }
  for (let r = 1; r <= rings; r++) {
    const rad = size * (0.16 + 0.17 * r) * (1 + 0.02 * Math.sin(r * 7.1));
    for (let i = 0; i < strands - 1; i++) {
      const a1 = angles[i];
      const a2 = angles[i + 1];
      const am = (a1 + a2) / 2;
      const sag = rad * 0.86;
      out.push(
        `M${(cx + Math.cos(a1) * rad).toFixed(1)} ${(cy + Math.sin(a1) * rad).toFixed(1)} ` +
          `Q${(cx + Math.cos(am) * sag).toFixed(1)} ${(cy + Math.sin(am) * sag).toFixed(1)} ` +
          `${(cx + Math.cos(a2) * rad).toFixed(1)} ${(cy + Math.sin(a2) * rad).toFixed(1)}`,
      );
    }
  }
  return out;
}

function Cobweb({ size, corner, color }: { size: number; corner: "left" | "right"; color: string }) {
  const paths = useMemo(() => cobwebPaths(size, corner), [size, corner]);
  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ position: "absolute", top: 0, [corner]: 0, opacity: 0.22 }}
      pointerEvents="none"
    >
      {paths.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={1} strokeLinecap="round" fill="none" />
      ))}
    </Svg>
  );
}

function Spider({ left, color, scale = 0.8 }: { left: number; color: string; scale?: number }) {
  return (
    <Svg
      width={30 * scale}
      height={70 * scale}
      viewBox="0 0 30 70"
      style={{ position: "absolute", top: 0, left, opacity: 0.75 }}
      pointerEvents="none"
    >
      <Line x1="15" y1="0" x2="15" y2="44" stroke={color} strokeWidth={1.2} strokeOpacity={0.8} />
      <G fill={color}>
        <Ellipse cx="15" cy="50" rx="4.5" ry="5.5" />
        <Circle cx="15" cy="43.5" r="2.6" />
      </G>
      <Path
        d="M11 47 L5 42 M11 49 L4 48 M11 52 L5 56 M11 54 L7 61 M19 47 L25 42 M19 49 L26 48 M19 52 L25 56 M19 54 L23 61"
        stroke={color}
        strokeWidth={1.2}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

/** Кладётся поверх шапки: родитель — View с position: "relative". */
export function HalloweenDecor({ size = 110, spiderLeft = 300 }: { size?: number; spiderLeft?: number }) {
  const theme = useTheme();
  const color = theme.colors.ink;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: size, zIndex: 3 }}>
      <Cobweb size={size} corner="left" color={color} />
      <Cobweb size={size} corner="right" color={color} />
      <Spider left={spiderLeft} color={color} />
    </View>
  );
}
