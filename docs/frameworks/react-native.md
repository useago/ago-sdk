# React Native (Expo)

`@useago/sdk/native` gives you the provider and the hooks without any DOM
component. You build the chat UI with React Native views.

```bash
npx create-expo-app@latest my-app && cd my-app
npx expo install @useago/sdk
```

```tsx
// app/_layout.tsx
import { AgoProvider } from "@useago/sdk/native";
import { fetch } from "expo/fetch";
import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <AgoProvider
      baseUrl="https://playground.api.useago.com"
      agent="generic-guide"
      fetch={fetch} // streams replies token by token
    >
      <Stack />
    </AgoProvider>
  );
}
```

```tsx
// app/index.tsx
import { useChat } from "@useago/sdk/native";
import { useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";

export default function Chat() {
  const { messages, sendMessage, isLoading } = useChat({ autoLoad: false });
  const [draft, setDraft] = useState("");

  return (
    <View style={{ flex: 1, padding: 12 }}>
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <Text style={{ marginVertical: 4 }}>
            {item.role === "user" ? "You: " : "Agent: "}
            {item.content}
          </Text>
        )}
      />
      <TextInput value={draft} onChangeText={setDraft} placeholder="Message" />
      <Button
        title="Send"
        disabled={isLoading}
        onPress={() => {
          sendMessage(draft);
          setDraft("");
        }}
      />
    </View>
  );
}
```

`npx expo start`, scan the QR code with Expo Go, and send "What can you do?".
The playground answers with no signup. Swap `baseUrl` for
`https://YOUR-DOMAIN.api.useago.com` when you have a tenant.

Replies are Markdown. Render `item.content` with a Markdown library
(`react-native-markdown-display`, for example) in a real app.

A full app lives in [`examples/simple-expo`](../../examples/simple-expo): a delivery app
where the assistant fills the order form from a plain-language request, tracks
parcels and gives quotes.

## Requirements

- **Expo SDK 53 or later.** The `@useago/sdk/native` subpath relies on package
  `exports`, which Metro resolves by default from SDK 53.
- **`fetch` from `expo/fetch`.** React Native's built-in `fetch` has no streaming
  body. Without `expo/fetch` replies still arrive, but in one piece once the
  agent is done.
- **React Native without Expo:** add the Expo modules
  (`npx install-expo-modules`), or pass any `fetch` whose `response.body` is a
  readable stream.

## Keep the visitor's id across launches

The SDK identifies the visitor with an anonymous id. On the web it lives in
`localStorage`. In React Native, pass a synchronous `storage`, otherwise a new id
(and an empty history) comes with every launch:

```tsx
import Storage from "expo-sqlite/kv-store";

const storage = {
  getItem: (key: string) => Storage.getItemSync(key),
  setItem: (key: string, value: string) => Storage.setItemSync(key, value),
};

<AgoProvider baseUrl="..." fetch={fetch} storage={storage}>
```

MMKV works too. AsyncStorage does not: it is asynchronous. If you already have a
stable user id, pass it as `widgetId` instead.

## Let the agent navigate your screens

expo-router paths are URLs, so the web route table works as is. Tell the SDK
where the user is with `getCurrentPath`, since there is no address bar:

```tsx
import { useAgoNavigation } from "@useago/sdk/native";
import { usePathname, useRouter } from "expo-router";

const ROUTES = [
  { name: "orders", path: "/orders", description: "List of all orders" },
  { name: "order", path: "/orders/:id", description: "One order, by id" },
];

function AgoNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  useAgoNavigation((path) => router.push(path), ROUTES, {
    getCurrentPath: () => pathname,
  });
  return null;
}
```

Render `<AgoNavigation />` inside `<AgoProvider>`. With react-navigation, map
each route to a screen in the callback and return the active route's path from
`getCurrentPath`.

`useAgoPageState`, `useAgoFunction` and `useAgoContext` work on any screen
exactly as on the web. See [Functions & context](../general/functions-and-context.md).

## Send files

Pickers return a URI, not a browser `File`. `toAgoFile` turns a picked asset into
the `{ uri, name, type }` shape the SDK uploads:

```tsx
import * as DocumentPicker from "expo-document-picker";
import { toAgoFile } from "@useago/sdk/native";

const result = await DocumentPicker.getDocumentAsync();
if (!result.canceled) {
  await sendMessage("Here is the file", result.assets.map(toAgoFile));
}
```

`fetch` cannot upload URI files, so a message with attachments goes through React
Native's `XMLHttpRequest` and its reply arrives in one piece.

`client.transcribeAudio({ uri, name, type })` takes a recording the same way
(from `expo-audio`, for example).

## What stays on the web

| Feature | On native |
| --- | --- |
| Hooks, functions, navigation, page state, context, feedback, stop | Same API |
| `ChatWidget`, `Message`, `Markdown`, `ChatInput` and other components | Not exported: they render HTML. Build the UI with React Native views |
| The `<script>` widget | Not applicable |
| Proactive nudges, `errorWatcher`, WebMCP, devtools panel | Not supported yet: they observe the browser (DOM events, `window` errors) |
