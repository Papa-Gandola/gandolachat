import { ReactNode, useRef } from "react";
import { Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

import { useTheme } from "../theme";

interface Props {
  onReply: () => void;
  children: ReactNode;
}

/**
 * Wraps a message row so a left-swipe reveals a reply hint and fires onReply.
 * The row snaps back immediately — this is a quick gesture, not a persistent
 * open state. A left swipe drags the content leftward, which Swipeable models
 * as the "right" action side.
 */
export function SwipeableMessage({ onReply, children }: Props) {
  const theme = useTheme();
  const ref = useRef<Swipeable>(null);
  return (
    <Swipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      // Only allow dragging left (toward the reply action) — disable the other
      // direction so horizontal swipes don't fight the vertical scroll.
      renderRightActions={() => (
        <View style={{ width: 64, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ fontSize: 20, color: theme.colors.accent }}>↩</Text>
        </View>
      )}
      onSwipeableWillOpen={(direction) => {
        if (direction === "right") {
          onReply();
          ref.current?.close();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}
