import React from "react";
import Icon from "./Icon";
import { splitPreviewIcon } from "../services/markers";

// Единый набор эмодзи (стиль «Б»): смайлики рисует встроенный шрифт Twemoji
// (global.css), а не системный шрифт Windows — ❤️ у всех одинаковые.
//
// Два слоя. (1) В общих стеках шрифтов «Twemoji Gandola» ограничен
// unicode-range только символами с эмодзи-презентацией (😂 🔥 ⛽ …): так
// текстовые знаки — ♠♥♦♣ покерных карт, ✓, ▶, ⚠ — остаются текстом, а не
// цветными наклейками. (2) Но «текстовые» символы с селектором FE0F (❤️ ✌️
// ⚠️ ⚔️) и составные последовательности через такой шрифт не проходят —
// их оборачивает <EmojiText>/<Emoji> классом .emoji с безусловной копией
// того же шрифта. Регэксп — по свойствам Unicode: эмодзи-презентация,
// пиктограмма+FE0F, пиктограмма с тоном кожи, флаги, кейкапы, ZWJ-цепочки.
const UNIT = "(?:\\p{Emoji_Presentation}\\uFE0F?|\\p{Extended_Pictographic}\\uFE0F|\\p{Extended_Pictographic}(?=\\p{Emoji_Modifier}))\\p{Emoji_Modifier}?";
export const EMOJI_RE = new RegExp(
  "\\p{Regional_Indicator}{2}" +
  "|[#*0-9]\\uFE0F?\\u20E3" +
  `|${UNIT}(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?(?:\\u200D${UNIT})*`,
  "gu",
);

/** Разбить строку на текст и эмодзи-последовательности. */
export function splitEmoji(text: string): Array<{ emoji: boolean; s: string }> {
  const out: Array<{ emoji: boolean; s: string }> = [];
  let last = 0;
  EMOJI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ emoji: false, s: text.slice(last, m.index) });
    out.push({ emoji: true, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ emoji: false, s: text.slice(last) });
  return out;
}

/** Текст, в котором эмодзи гарантированно рисуются шрифтом Twemoji. */
export function EmojiText({ text }: { text: string }) {
  const parts = splitEmoji(text);
  if (!parts.some((p) => p.emoji)) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (p.emoji ? <span key={i} className="emoji">{p.s}</span> : <React.Fragment key={i}>{p.s}</React.Fragment>))}
    </>
  );
}

/** Одиночный эмодзи (реакция, кнопка пикера). */
export function Emoji({ e, style }: { e: string; style?: React.CSSProperties }) {
  return <span className="emoji" style={style}>{e}</span>;
}

/** Превью служебного/файлового сообщения (markers.ts): ведущий значок —
 *  линейной иконкой, остальное — текстом с эмодзи из шрифта. */
export function PreviewText({ text, iconSize = 12 }: { text: string; iconSize?: number }) {
  const { icon, rest } = splitPreviewIcon(text);
  return (
    <>
      {icon && <Icon name={icon} size={iconSize} style={{ marginRight: 4, verticalAlign: "-0.12em" }} />}
      <EmojiText text={rest} />
    </>
  );
}
