// On-device check of @useago/sdk/native: open /sdk-test, the checks run on
// mount against the playground and log "[AGO-TEST] ..." lines to Metro.
import { AgoClient, type AgoMessage } from "@useago/sdk/native";
import { fetch as expoFetch } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";

const BASE = { baseUrl: "https://playground.api.useago.com", agent: "generic-guide" };
const storage = {
  getItem: (key: string) => Storage.getItemSync(key),
  setItem: (key: string, value: string) => Storage.setItemSync(key, value),
};
const SPEECH_SAMPLE =
  "https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav";

interface Result {
  name: string;
  status: "running" | "pass" | "fail";
  detail: string;
}

type Check = { name: string; run: () => Promise<{ pass: boolean; detail: string }> };

/** Send a message and record when each streamed chunk arrived. */
async function timedSend(
  client: AgoClient,
  text: string,
  options: Parameters<AgoClient["sendMessage"]>[1] = {},
  onFirstChunk?: () => void,
) {
  const start = Date.now();
  const chunkTimes: number[] = [];
  const onChunk = () => {
    chunkTimes.push(Date.now() - start);
    if (chunkTimes.length === 1) onFirstChunk?.();
  };
  client.on("message:chunk", onChunk);
  try {
    const message: AgoMessage = await client.sendMessage(text, options);
    return { message, chunkTimes, totalMs: Date.now() - start };
  } finally {
    client.off("message:chunk", onChunk);
  }
}

const CHECKS: Check[] = [
  {
    name: "Runtime",
    run: async () => ({
      pass: true,
      detail: `${Platform.OS} ${Platform.Version}, Hermes=${"HermesInternal" in globalThis}, TextDecoder=${typeof TextDecoder}, ReadableStream=${typeof ReadableStream}, global fetch is expo/fetch=${globalThis.fetch === (expoFetch as unknown)}, XMLHttpRequest=${typeof XMLHttpRequest}`,
    }),
  },
  {
    name: "Streaming with expo/fetch",
    run: async () => {
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const { message, chunkTimes, totalMs } = await timedSend(
        client,
        "Count from 1 to 40, one number per line, nothing else.",
      );
      client.destroy();
      const spread = chunkTimes.length ? chunkTimes[chunkTimes.length - 1] - chunkTimes[0] : 0;
      return {
        pass: chunkTimes.length >= 5 && spread > 200 && message.content.length > 0,
        detail: `${chunkTimes.length} chunks, first at ${chunkTimes[0]} ms, last at ${chunkTimes[chunkTimes.length - 1]} ms, done at ${totalMs} ms, ${message.content.length} chars`,
      };
    },
  },
  {
    name: "Accents, CJK and emoji",
    run: async () => {
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const { message } = await timedSend(
        client,
        "Reply exactly with this text and nothing else: Café crème, déjà vu, 你好, 👋🚚",
      );
      client.destroy();
      const c = message.content;
      const ok = c.includes("é") && c.includes("你好") && c.includes("👋") && !c.includes("\ufffd");
      return { pass: ok, detail: JSON.stringify(c.slice(0, 80)) };
    },
  },
  {
    name: "Global fetch (no fetch option)",
    run: async () => {
      const client = new AgoClient({ ...BASE, storage });
      const { message, chunkTimes, totalMs } = await timedSend(client, "Say hello in three words.");
      client.destroy();
      return {
        pass: message.content.length > 0 && message.status === "DONE",
        detail: `${chunkTimes.length} chunk events, first at ${chunkTimes[0]} ms, done at ${totalMs} ms: ${JSON.stringify(message.content.slice(0, 60))}`,
      };
    },
  },
  {
    name: "Bodyless reply read in one piece",
    run: async () => {
      // Hand the SDK what React Native's own fetch returns: no `body`, only text().
      const bodyless = async (url: string, init: RequestInit) => {
        const res = await expoFetch(url, init as never);
        const text = await res.text();
        return { ok: res.ok, status: res.status, statusText: res.statusText, body: null, text: async () => text } as unknown as Response;
      };
      const client = new AgoClient({ ...BASE, fetch: bodyless, storage });
      const { message, chunkTimes, totalMs } = await timedSend(client, "Say hello in three words.");
      client.destroy();
      return {
        pass: message.status === "DONE" && message.content.length > 0,
        detail: `${chunkTimes.length} chunk events at ${chunkTimes.join(", ")} ms (all at the end, done ${totalMs} ms): ${JSON.stringify(message.content.slice(0, 60))}`,
      };
    },
  },
  {
    name: "Visitor id persisted (storage)",
    run: async () => {
      // Constructing a client generates (or reuses) the id in `storage`.
      new AgoClient({ ...BASE, fetch: expoFetch, storage }).destroy();
      const id = Storage.getItemSync("ago_widget_id");
      const previous = Storage.getItemSync("ago_test_previous_id");
      Storage.setItemSync("ago_test_previous_id", id ?? "");
      return {
        pass: !!id && (previous === null || previous === id),
        detail: `id=${id}; previous launch: ${previous === null ? "none (first run)" : previous === id ? "same id" : `DIFFERENT (${previous})`}`,
      };
    },
  },
  {
    name: "JSON requests (conversation list)",
    run: async () => {
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const page = await client.getConversations();
      client.destroy();
      return { pass: Array.isArray(page.data), detail: `${page.data.length} of ${page.total} conversations for this visitor` };
    },
  },
  {
    name: "Upload a { uri } file",
    run: async () => {
      const file = new File(Paths.cache, "ago-secret.txt");
      if (file.exists) file.delete();
      file.create();
      await file.write("The secret word is PAMPLEMOUSSE.");
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const { message } = await timedSend(
        client,
        "What is the secret word in the attached file? Reply with just the word.",
        { files: [{ uri: file.uri, name: "ago-secret.txt", type: "text/plain" }] },
      );
      client.destroy();
      return {
        pass: /pamplemousse/i.test(message.content),
        detail: `reply: ${JSON.stringify(message.content.slice(0, 80))}`,
      };
    },
  },
  {
    name: "{ uri } recording bytes (multipart echo)",
    run: async () => {
      const target = new File(Paths.cache, "ago-speech-echo.wav");
      if (target.exists) target.delete();
      const wav = await File.downloadFileAsync(SPEECH_SAMPLE, target);
      const client = new AgoClient({ baseUrl: "https://httpbin.org/anything", widgetId: "echo-visitor", fetch: expoFetch });
      const echo = (await client.transcribeAudio({ uri: wav.uri, name: "speech.wav", type: "audio/wav" })) as unknown as {
        files?: Record<string, string>;
      };
      client.destroy();
      const dataUrl = echo.files?.file ?? "";
      // httpbin returns binary parts as a base64 data URL.
      const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      return {
        pass: dataUrl.startsWith("data:audio/wav;base64,") && bytes > 500_000,
        detail: `server received ${bytes} bytes (file on disk: ${wav.size} bytes)`,
      };
    },
  },
  {
    name: "{ uri } upload bytes (multipart echo)",
    run: async () => {
      // httpbin echoes the multipart body back, proving the file left the disk intact.
      const file = new File(Paths.cache, "ago-echo.txt");
      if (file.exists) file.delete();
      file.create();
      await file.write("Café PAMPLEMOUSSE 👋");
      const client = new AgoClient({ baseUrl: "https://httpbin.org/anything", widgetId: "echo-visitor", fetch: expoFetch });
      const echo = (await client.transcribeAudio({ uri: file.uri, name: "ago-echo.txt", type: "text/plain" })) as unknown as {
        files?: Record<string, string>;
        headers?: Record<string, string>;
      };
      client.destroy();
      const received = echo.files?.file ?? "";
      const anonId = echo.headers?.["X-User-Anon-Id"];
      return {
        pass: received === "Café PAMPLEMOUSSE 👋" && anonId === "echo-visitor",
        detail: `server received file=${JSON.stringify(received)}, X-User-Anon-Id=${anonId}`,
      };
    },
  },
  {
    name: "Stop mid-stream",
    run: async () => {
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const { message, chunkTimes } = await timedSend(
        client,
        "Write a 300-word story about a delivery van in Avignon.",
        {},
        () => void client.stop(),
      );
      client.destroy();
      return {
        pass: message.status === "CANCELED",
        detail: `status=${message.status}, ${chunkTimes.length} chunks kept, ${message.content.length} chars`,
      };
    },
  },
  {
    name: "Transcribe a { uri } recording",
    run: async () => {
      const target = new File(Paths.cache, "ago-speech.wav");
      if (target.exists) target.delete();
      const wav = await File.downloadFileAsync(SPEECH_SAMPLE, target);
      const client = new AgoClient({ ...BASE, fetch: expoFetch, storage });
      const { text } = await client.transcribeAudio({ uri: wav.uri, name: "speech.wav", type: "audio/wav" });
      client.destroy();
      return { pass: text.trim().length > 0, detail: JSON.stringify(text.slice(0, 90)) };
    },
  },
];

export default function SdkTestScreen() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);

  const runAll = async () => {
    setRunning(true);
    setResults([]);
    console.log("[AGO-TEST] start");
    for (const check of CHECKS) {
      setResults((r) => [...r, { name: check.name, status: "running", detail: "" }]);
      let result: Result;
      try {
        const { pass, detail } = await check.run();
        result = { name: check.name, status: pass ? "pass" : "fail", detail };
      } catch (error) {
        result = { name: check.name, status: "fail", detail: `threw: ${error instanceof Error ? error.message : String(error)}` };
      }
      console.log(`[AGO-TEST] ${result.status.toUpperCase()} ${result.name}: ${result.detail}`);
      setResults((r) => [...r.slice(0, -1), result]);
    }
    console.log("[AGO-TEST] done");
    setRunning(false);
  };

  useEffect(() => {
    void runAll();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 140 }}>
      <Pressable
        onPress={() => !running && void runAll()}
        style={{ backgroundColor: running ? "#999" : "#5B2380", padding: 12, borderRadius: 20, alignItems: "center" }}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>{running ? "Running…" : "Run again"}</Text>
      </Pressable>
      {results.map((r) => (
        <View key={r.name} style={{ borderWidth: 1, borderColor: "#e5e5ea", borderRadius: 12, padding: 10, gap: 4 }}>
          <Text style={{ fontWeight: "700", color: r.status === "pass" ? "#1F9D6B" : r.status === "fail" ? "#b00020" : "#666" }}>
            {r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "…"} {r.name}
          </Text>
          {!!r.detail && <Text style={{ color: "#333", fontSize: 12 }}>{r.detail}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}
