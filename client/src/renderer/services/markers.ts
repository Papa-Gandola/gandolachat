// Служебные маркеры сообщений → человеческое превью (сайдбар, уведомления).
// Без этого в превью и нотификациях светился бы сырой "/quest_card {json}".
// Строки со значком-эмодзи впереди: в системных уведомлениях так и уходят,
// а в интерфейсе ведущий значок превращается в линейную иконку
// (PREVIEW_ICONS + <PreviewText> из Emoji.tsx) — стиль «Б».
import type { IconName } from "../components/icons";

/** Ведущий значок превью → иконка единого набора. Чего тут нет
 *  (💀 🤝 🚨 …) — остаётся эмодзи из шрифта Twemoji. */
export const PREVIEW_ICONS: Record<string, IconName> = {
  "🎤": "mic", "🖼": "image", "🎬": "film", "🎵": "music", "📎": "clip", "📊": "poll", "⏰": "bell",
  "🃏": "cards", "📞": "phone", "⚔️": "swords", "🏆": "trophy", "🎲": "dice", "📅": "calendar",
};

export function splitPreviewIcon(text: string): { icon: IconName | null; rest: string } {
  for (const glyph of Object.keys(PREVIEW_ICONS)) {
    if (text.startsWith(glyph + " ")) return { icon: PREVIEW_ICONS[glyph], rest: text.slice(glyph.length + 1) };
  }
  return { icon: null, rest: text };
}
/** Превью файлового сообщения по имени файла: голосовые с телефона
 *  приходят как voice_<ts>.m4a — в сайдбаре/закрепах вместо этого
 *  показываем человеческое «🎤 Голосовое». */
export function filePreview(name: string | null | undefined): string {
  if (!name) return "📎 Файл";
  if (/^voice_\d+\.(m4a|mp3|ogg|opus|webm|aac)$/i.test(name)) return "🎤 Голосовое";
  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(name)) return "🖼 Фото";
  if (/\.(mp4|mov|m4v|mkv|webm|3gp)$/i.test(name)) return "🎬 Видео";
  if (/\.(m4a|mp3|ogg|opus|wav|aac|flac)$/i.test(name)) return `🎵 ${name}`;
  return `📎 ${name}`;
}

export function markerPreview(content: string): string | null {
  if (content.startsWith("/quest_card ")) {
    try {
      const p = JSON.parse(content.slice(12));
      if (p.kind === "season_final") return `🏆 Итоги сезона: чемпион — ${p.podium?.[0]?.username ?? "?"}`;
      if (p.kind === "bet_result") return `🎲 Ставки: катка ${p.target ?? "?"}`;
      if (p.kind === "week_recap") return "📅 Итоги недели";
      if (p.special === "rampage") return `🚨 РАМПАГА: ${p.username}!`;
      if (p.special === "fullstack") return "🏆 СТАК ПОБЕДИЛ";
      if (p.kind === "anti") return `💀 Прожарка: ${p.username}`;
      if (p.kind === "team") return `🤝 ${(p.who || p.names || []).join(" + ")}`;
      return `⛽ ${p.username} закрыл задание`;
    } catch {
      return "⛽ Компендиум";
    }
  }
  if (content === "/dota_call") return "⚔️ Газуем в дотан";
  if (/^\/poll \d+$/.test(content)) return "📊 Опрос";
  if (content.startsWith("/reminder ")) return "⏰ Напоминание";
  if (/^\/poker_table \d+$/.test(content)) return "🃏 Покерный стол";
  if (/^\/call_record (completed|missed|declined|cancelled)\|/.test(content)) return "📞 Звонок";
  return null;
}
