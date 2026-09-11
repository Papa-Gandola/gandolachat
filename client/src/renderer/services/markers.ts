// Служебные маркеры сообщений → человеческое превью (сайдбар, уведомления).
// Без этого в превью и нотификациях светился бы сырой "/quest_card {json}".
export function markerPreview(content: string): string | null {
  if (content.startsWith("/quest_card ")) {
    try {
      const p = JSON.parse(content.slice(12));
      if (p.kind === "season_final") return `🏆 Итоги сезона: чемпион — ${p.podium?.[0]?.username ?? "?"}`;
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
  if (content.startsWith("/reminder ")) return "⏰ Напоминание";
  if (/^\/poker_table \d+$/.test(content)) return "🃏 Покерный стол";
  if (/^\/call_record (completed|missed|declined|cancelled)\|/.test(content)) return "📞 Звонок";
  return null;
}
