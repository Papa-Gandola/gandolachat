import React, { useMemo } from "react";

// Хеллоуин в Гандолиуме (октябрь, тема приходит с сервера: /me.theme ===
// "halloween"): паутина в верхних углах, паучок на нити, всё поверх шапки и
// мимо кликов. Рисуется SVG-ом на лету — радиальные нити из угла и
// «провисающие» кольца между ними (quadratic-кривые с контрольной точкой
// ближе к углу — нить прогибается внутрь, как настоящая). Референс
// хозяин одобрил 30.09.

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
    const ex = cx + Math.cos(ang) * size * jitter;
    const ey = cy + Math.sin(ang) * size * jitter;
    out.push(`M${cx} ${cy} L${ex.toFixed(1)} ${ey.toFixed(1)}`);
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

function Cobweb({ size, corner }: { size: number; corner: "left" | "right" }) {
  const paths = useMemo(() => cobwebPaths(size, corner), [size, corner]);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      style={{ position: "absolute", top: 0, [corner]: 0, opacity: 0.22, pointerEvents: "none" }}
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

function Spider({ left, scale = 1 }: { left: string; scale?: number }) {
  return (
    <svg
      width={30 * scale}
      height={70 * scale}
      viewBox="0 0 30 70"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      style={{ position: "absolute", top: 0, left, opacity: 0.75, pointerEvents: "none" }}
    >
      <line x1="15" y1="0" x2="15" y2="44" strokeOpacity="0.8" />
      <g fill="currentColor" stroke="none">
        <ellipse cx="15" cy="50" rx="4.5" ry="5.5" />
        <circle cx="15" cy="43.5" r="2.6" />
      </g>
      <path d="M11 47 L5 42 M11 49 L4 48 M11 52 L5 56 M11 54 L7 61 M19 47 L25 42 M19 49 L26 48 M19 52 L25 56 M19 54 L23 61" />
    </svg>
  );
}

// Кладётся первым ребёнком в position:relative-контейнер шапки.
export default function HalloweenDecor({ size = 170, spiderLeft = "52%" }: { size?: number; spiderLeft?: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", color: "var(--text-primary)", zIndex: 1 }}>
      <Cobweb size={size} corner="left" />
      <Cobweb size={size} corner="right" />
      <Spider left={spiderLeft} />
    </div>
  );
}
