#!/usr/bin/env node
/**
 * react-native-webrtc 124.0.8 кладёт в пакет lib/typescript/*.d.ts, которые
 * импортируют `./vendor/event-target-shim` — а этой папки в lib/typescript
 * нет (она осталась только в src/). Для tsc это значит, что RTCPeerConnection
 * «не имеет» addEventListener и весь webrtc.ts краснеет. На сборку (Metro,
 * EAS) типы не влияют — это только про `npx tsc`.
 *
 * Докладываем недостающий d.ts из src. Идемпотентно, при отсутствии
 * источника молчим (другая версия библиотеки, где это уже починили).
 * Зовётся из postinstall.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules", "react-native-webrtc");
const src = path.join(root, "src", "vendor", "event-target-shim", "index.d.ts");
const dstDir = path.join(root, "lib", "typescript", "vendor", "event-target-shim");
const dst = path.join(dstDir, "index.d.ts");

try {
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    fs.mkdirSync(dstDir, { recursive: true });
    fs.copyFileSync(src, dst);
    console.log("patch-webrtc-types: copied event-target-shim typings into lib/typescript");
  }
} catch (e) {
  console.warn("patch-webrtc-types: skipped —", e && e.message);
}
