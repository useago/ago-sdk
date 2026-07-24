// Bundle assertion (CI-runnable, after `npm run build`): chat-only entries
// must contain ZERO voice engine or audio worklet source. The engine only
// loads through the dynamic import behind `client.voice`, so it must land in
// its own chunk, referenced (not inlined) by the core entries.
//
// Fails loudly when the marker strings leak into a chat-only entry, or when
// they are missing from the dist output entirely (which would mean the voice
// entry itself broke).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = new URL("../dist", import.meta.url).pathname;

// Registered worklet processor names: present verbatim in the worklet sources
// and nowhere else.
const MARKERS = ["ago-pcm-capture-processor", "ago-pcm-playback-processor"];

// Entries a chat-only consumer bundles.
const CHAT_ONLY_ENTRIES = [
  "index.js",
  "index.cjs",
  "react.js",
  "react.cjs",
  "widget.js",
  "widget.cjs",
];

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...listFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

let failures = 0;

for (const entry of CHAT_ONLY_ENTRIES) {
  const path = join(DIST, entry);
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const marker of MARKERS) {
    if (content.includes(marker)) {
      console.error(
        `FAIL: ${entry} contains worklet source marker "${marker}". ` +
          "The voice engine leaked into a chat-only entry."
      );
      failures++;
    }
  }
}

const allJs = listFiles(DIST).filter(
  (p) => p.endsWith(".js") || p.endsWith(".cjs")
);
const markerFound = MARKERS.every((marker) =>
  allJs.some((p) => readFileSync(p, "utf8").includes(marker))
);
if (!markerFound) {
  console.error(
    "FAIL: worklet source markers not found anywhere in dist. " +
      "The voice entry no longer carries the worklet sources."
  );
  failures++;
}

if (failures > 0) {
  process.exit(1);
}
console.log(
  "OK: chat-only entries contain no worklet source; voice chunk carries it."
);
