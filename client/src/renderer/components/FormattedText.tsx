import React, { useState } from "react";
import { useTheme } from "../services/theme";

// Parse markdown-like syntax into React nodes
// Supports: **bold**, *italic*, ~~strike~~, __underline__, ||spoiler||
type Node = { type: "text" | "bold" | "italic" | "strike" | "underline" | "spoiler"; content: string | Node[] };

function parse(text: string): Node[] {
  const nodes: Node[] = [];
  let i = 0;
  let current = "";

  const flush = () => {
    if (current) {
      nodes.push({ type: "text", content: current });
      current = "";
    }
  };

  while (i < text.length) {
    // Try each marker (longest first)
    const tryMarker = (marker: string, type: Node["type"]) => {
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

function renderNodes(nodes: Node[], key = 0): React.ReactNode[] {
  return nodes.map((node, idx) => {
    const k = `${key}-${idx}`;
    if (node.type === "text") return <React.Fragment key={k}>{node.content as string}</React.Fragment>;
    const inner = renderNodes(node.content as Node[], idx);
    if (node.type === "bold") return <strong key={k}>{inner}</strong>;
    if (node.type === "italic") return <em key={k}>{inner}</em>;
    if (node.type === "strike") return <s key={k}>{inner}</s>;
    if (node.type === "underline") return <u key={k}>{inner}</u>;
    if (node.type === "spoiler") return <Spoiler key={k}>{inner}</Spoiler>;
    return null;
  });
}

function Spoiler({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const isNeo = theme === "neo";
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); setRevealed(!revealed); }}
      style={{
        background: revealed
          ? (isNeo ? "rgba(198,255,61,0.15)" : "rgba(255,255,255,0.1)")
          : (isNeo ? "#000" : "#1a1b1e"),
        color: revealed ? "inherit" : "transparent",
        borderRadius: isNeo ? 0 : 3,
        border: isNeo && !revealed ? "1px solid var(--accent)" : undefined,
        padding: "0 3px",
        cursor: "pointer",
        transition: "all 0.2s",
        userSelect: revealed ? "text" : "none",
      }}
    >
      {children}
    </span>
  );
}

export default function FormattedText({ text }: { text: string }) {
  const nodes = parse(text);
  return <>{renderNodes(nodes)}</>;
}
