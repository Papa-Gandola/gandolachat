import React from "react";
import { ICON_PATHS, IconName } from "./icons";

/** Линейная иконка из единого набора (icons.ts). Размер — в пикселях,
 *  цвет наследуется от текста (currentColor), по вертикали садится на
 *  строку как символ. `title` — подсказка при наведении. */
export default function Icon({
  name, size = 16, strokeWidth = 1.75, title, style, className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  title?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      style={{ display: "inline-block", verticalAlign: "-0.18em", flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + ICON_PATHS[name] }}
    />
  );
}

/** Иконка в потоке текста: с отступом справа, как «📎 файл» раньше. */
export function IconText({ name, size = 14, gap = 5, ...rest }: {
  name: IconName; size?: number; gap?: number; strokeWidth?: number; title?: string; style?: React.CSSProperties;
}) {
  return <Icon name={name} size={size} {...rest} style={{ marginRight: gap, ...rest.style }} />;
}

/** ⛽ — фирменный значок газа Гандолиума. Хозяин попросил вернуть ЭМОДЗИ
 *  (линейная колонка никому не зашла): рисуется шрифтом Twemoji (класс
 *  .emoji), так что у всех одинаковый. size — в px, как у иконок. */
export function Gas({ size = 13, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <span className="emoji" style={{ fontSize: size, lineHeight: 1, verticalAlign: "-0.1em", display: "inline-block", ...style }}>⛽</span>
  );
}
