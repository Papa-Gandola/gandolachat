import { ReactNode, useState } from "react";
import { Linking, Text, TextStyle } from "react-native";

import { useTheme } from "../theme";

// Markdown-lite parser, ported 1:1 from the desktop client's FormattedText so
// both platforms render the same syntax: **bold**, *italic*, ~~strike~~,
// __underline__, ||spoiler||, ***bolditalic***, and bare http(s) links.
type NodeType = "text" | "bold" | "bolditalic" | "italic" | "strike" | "underline" | "spoiler";
type Node = { type: NodeType; content: string | Node[] };

function parse(text: string): Node[] {
  const nodes: Node[] = [];
  if (typeof text !== "string") return nodes;
  let i = 0;
  let current = "";

  const flush = () => {
    if (current) {
      nodes.push({ type: "text", content: current });
      current = "";
    }
  };

  while (i < text.length) {
    const tryMarker = (marker: string, type: NodeType) => {
      if (text.startsWith(marker, i)) {
        const end = text.indexOf(marker, i + marker.length);
        if (end > i + marker.length) {
          flush();
          const inner = text.slice(i + marker.length, end);
          nodes.push({ type, content: parse(inner) });
          i = end + marker.length;
          return true;
        }
      }
      return false;
    };

    if (
      tryMarker("***", "bolditalic") ||
      tryMarker("**", "bold") ||
      tryMarker("__", "underline") ||
      tryMarker("~~", "strike") ||
      tryMarker("||", "spoiler") ||
      tryMarker("*", "italic")
    ) {
      continue;
    }

    current += text[i];
    i++;
  }
  flush();
  return nodes;
}

const URL_RE = /(https?:\/\/[^\s<>]+)/gi;

// Split a plain string into text + tappable link fragments.
function renderText(text: string, keyBase: string, linkColor: string): ReactNode[] {
  const out: ReactNode[] = [];
  if (typeof text !== "string") return out;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  let counter = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    let url = match[0];
    const trailing = url.match(/[.,!?;:)\]}]+$/);
    if (trailing) url = url.slice(0, url.length - trailing[0].length);
    if (match.index > lastIdx) {
      out.push(<Text key={`${keyBase}-t${counter++}`}>{text.slice(lastIdx, match.index)}</Text>);
    }
    const href = url;
    out.push(
      <Text
        key={`${keyBase}-l${counter++}`}
        style={{ color: linkColor, textDecorationLine: "underline" }}
        onPress={() => Linking.openURL(href).catch(() => {})}
      >
        {url}
      </Text>,
    );
    lastIdx = match.index + url.length;
  }
  if (lastIdx < text.length) {
    out.push(<Text key={`${keyBase}-t${counter++}`}>{text.slice(lastIdx)}</Text>);
  }
  return out;
}

function renderNodes(
  nodes: Node[],
  linkColor: string,
  key = 0,
  noBold = false,
  staticSpoiler = false,
): ReactNode[] {
  return nodes.map((node, idx) => {
    const k = `${key}-${idx}`;
    if (node.type === "text") return renderText(node.content as string, k, linkColor);
    const inner = renderNodes(node.content as Node[], linkColor, idx, noBold, staticSpoiler);
    // Nested <Text> inherits + merges parent text styles in RN, so wrapping is enough.
    if (node.type === "bolditalic")
      return (
        <Text key={k} style={noBold ? { fontStyle: "italic" } : { fontWeight: "700", fontStyle: "italic" }}>
          {inner}
        </Text>
      );
    if (node.type === "bold")
      return noBold ? (
        <Text key={k}>{inner}</Text>
      ) : (
        <Text key={k} style={{ fontWeight: "700" }}>
          {inner}
        </Text>
      );
    if (node.type === "italic")
      return (
        <Text key={k} style={{ fontStyle: "italic" }}>
          {inner}
        </Text>
      );
    if (node.type === "strike")
      return (
        <Text key={k} style={{ textDecorationLine: "line-through" }}>
          {inner}
        </Text>
      );
    if (node.type === "underline")
      return (
        <Text key={k} style={{ textDecorationLine: "underline" }}>
          {inner}
        </Text>
      );
    if (node.type === "spoiler")
      return (
        <Spoiler key={k} staticMode={staticSpoiler}>
          {inner}
        </Spoiler>
      );
    return null;
  });
}

function Spoiler({ children, staticMode = false }: { children: ReactNode; staticMode?: boolean }) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  const hidden = staticMode || !revealed;
  return (
    <Text
      onPress={staticMode ? undefined : () => setRevealed((v) => !v)}
      style={{
        backgroundColor: hidden ? "#1a1b1e" : "rgba(255,255,255,0.1)",
        color: hidden ? "transparent" : (theme.colors.ink as string),
        borderRadius: 3,
      }}
    >
      {children}
    </Text>
  );
}

interface Props {
  text: string;
  // Base text style (size, color, lineHeight, fontFamily) applied to the root.
  style?: TextStyle;
  numberOfLines?: number;
  // Compact mode for sidebar/reply previews: suppress bold, freeze spoilers.
  noBold?: boolean;
  staticSpoiler?: boolean;
}

export function FormattedText({ text, style, numberOfLines, noBold = false, staticSpoiler = false }: Props) {
  const theme = useTheme();
  const linkColor = theme.colors.accent as string;
  const nodes = parse(text);
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {renderNodes(nodes, linkColor, 0, noBold, staticSpoiler)}
    </Text>
  );
}
