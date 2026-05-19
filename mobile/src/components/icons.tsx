import { Circle, Path, Svg } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export function ChevronLeftIcon({ size = 22, color = "currentColor", strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path d="M15 18 L9 12 L15 6" strokeLinecap="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 22, color = "currentColor", strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path d="M5 5 L17 17 M17 5 L5 17" strokeLinecap="round" />
    </Svg>
  );
}

export function SearchIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Circle cx="10" cy="10" r="7" />
      <Path d="M15 15 L20 20" strokeLinecap="round" />
    </Svg>
  );
}

export function SettingsIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Circle cx="11" cy="11" r="2.5" />
      <Path
        d="M11 2v3M11 17v3M2 11h3M17 11h3M4.5 4.5l2 2M15.5 15.5l2 2M4.5 17.5l2-2M15.5 6.5l2-2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ChatBubbleIcon({ size = 20, color = "currentColor", strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path d="M2 4 H18 V14 H6 L2 17 Z" strokeLinejoin="round" />
    </Svg>
  );
}

export function PhoneIcon({ size = 20, color = "currentColor", strokeWidth = 1.6 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path
        d="M3 4 L6 3 L8 7 L6 8.5 Q 8 13, 12 14.5 L 13.5 12.5 L 17.5 14.5 L 16.5 17.5 Q 9 17, 4 12 Q 1.5 6.5, 3 4 Z"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PersonIcon({ size = 20, color = "currentColor", strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Circle cx="10" cy="7" r="3.4" />
      <Path d="M3 17 Q 3 12, 10 12 Q 17 12, 17 17" strokeLinecap="round" />
    </Svg>
  );
}

export function PlusIcon({ size = 26, color = "currentColor", strokeWidth = 2.4 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path d="M3 5 H21 V16 H8 L3 20 Z" strokeLinejoin="round" />
      <Path d="M12 8 V13 M9.5 10.5 H14.5" strokeLinecap="round" />
    </Svg>
  );
}

export function SendIcon({ size = 22, color = "currentColor", strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Path d="M3 12 L21 4 L15 21 L11 13 L3 12 Z" strokeLinejoin="round" />
    </Svg>
  );
}
