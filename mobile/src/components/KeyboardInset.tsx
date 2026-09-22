import { ReactNode } from "react";
import { Platform, View } from "react-native";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Эмуляция adjustResize для Android в edge-to-edge (SDK 57 / RN 0.86):
 * приложение целиком ужимается над клавиатурой, как на старых сборках.
 *
 * Почему не штатно: с edge-to-edge окно под клавиатуру больше не ужимается
 * (setDecorFitsSystemWindows(false), adjustResize игнорируется), а
 * KeyboardAvoidingView на Android бесполезен — событие keyboardDidShow от RN
 * отдаёт screenY по видимой рамке окна, которая тут не меняется, и KAV
 * считает перекрытие нулевым; поле ввода накрывало целиком (0.9.0–0.9.2).
 *
 * Источник высоты — reanimated: его нативный слушатель висит на decorView
 * (OnApplyWindowInsetsListener + WindowInsetsAnimationCallback) и отдаёт
 * инсет ime() покадрово, вместе с панелью функций/подсказок клавиатуры —
 * она часть окна IME. Оба флага translucent ОБЯЗАТЕЛЬНЫ: без них reanimated
 * сам дописывает отступы системных полос корню Activity (двойной статус-бар
 * поверх наших SafeAreaView). С ними высота меряется от нижнего края экрана,
 * поэтому вычитаем инсет навигационной полосы (safe-area её и держит: ime()
 * в safe-area-context не входит, см. SafeAreaUtils.kt). Натив reanimated в
 * сборке есть — едет по OTA. Хук помечен deprecated в пользу
 * react-native-keyboard-controller — тот потребует нового APK.
 */
export function KeyboardInset({ children }: { children: ReactNode }) {
  if (Platform.OS !== "android") return <View style={{ flex: 1 }}>{children}</View>;
  return <AndroidKeyboardInset>{children}</AndroidKeyboardInset>;
}

function AndroidKeyboardInset({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const navBar = insets.bottom;
  const style = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - navBar),
  }));
  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}
