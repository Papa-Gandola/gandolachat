import { useWindowDimensions } from "react-native";

// Широкий экран — PWA в браузере на компе или планшет в ландшафте: список
// чатов живёт слева постоянной колонкой, переписка/вкладки — справа
// (см. navigation/MainTabs + ChatsSidebar). Айфон/телефон (< 900px) —
// обычный стек. Порог единый, меняется здесь.
export const WIDE_MIN_WIDTH = 900;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN_WIDTH;
}
