import { useChat, type AgoMessage } from "@useago/sdk/native";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { COLORS } from "./theme";

const SUGGESTIONS = [
  "Send flowers from my shop to my mum this afternoon",
  "Where is my parcel?",
  "How much to send a fridge to Carpentras?",
  "Which delivery pays the most for me?",
];

// Floating assistant: a pink button that opens the chat over the bottom half,
// so the screen above stays visible while the assistant navigates and fills it.
export function Assistant() {
  const [open, setOpen] = useState(false);
  const { messages, sendMessage, stop, isLoading, error } = useChat({ autoLoad: false });
  const [draft, setDraft] = useState("");
  const list = useRef<FlatList<AgoMessage>>(null);
  // Same gesture-bar clearance as the tab bar.
  const gestureBar = Math.max(useSafeAreaInsets().bottom, 20);

  const send = (text = draft.trim()) => {
    if (!text || isLoading) return;
    setDraft("");
    void sendMessage(text);
  };

  if (!open) {
    return (
      <Pressable
        style={[styles.fab, { bottom: gestureBar + 64 }]}
        onPress={() => setOpen(true)}
        testID="assistant-open"
      >
        <Text style={styles.fabText}>Ask Tut Tut</Text>
      </Pressable>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.sheet}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>T</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tut Tut assistant</Text>
          <Text style={styles.subtitle}>Sends, tracks and answers for you</Text>
        </View>
        <Pressable onPress={() => setOpen(false)} hitSlop={12}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <FlatList
        ref={list}
        style={{ flex: 1 }}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <Bubble message={item} />}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={[styles.bubble, styles.theirs]}>
            <Text style={styles.theirsText}>
              Hi Camille! Tell me what you need to send, and where. I fill in the delivery for you,
              you just confirm. I can also track a parcel or give you a price.
            </Text>
          </View>
        }
      />

      {error && <Text style={styles.error}>{error.message}</Text>}

      <ScrollView
        horizontal
        style={styles.suggestionRow}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.suggestions}
        keyboardShouldPersistTaps="handled"
      >
        {SUGGESTIONS.map((s) => (
          <Pressable key={s} onPress={() => send(s)} style={styles.suggestion}>
            <Text style={styles.suggestionText}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="What do you need to send?"
          placeholderTextColor={COLORS.grey}
          onSubmitEditing={() => send()}
          returnKeyType="send"
        />
        <Pressable onPress={() => (isLoading ? void stop() : send())} style={styles.sendButton}>
          <Text style={styles.sendText}>{isLoading ? "Stop" : "Send"}</Text>
        </Pressable>
      </View>
      <View style={{ height: gestureBar + 8 }} />
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: AgoMessage }) {
  const mine = message.role === "user";
  const waiting = !mine && !message.content && message.status !== "DONE";
  return (
    <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
      {waiting ? (
        <ActivityIndicator color={COLORS.pink} />
      ) : (
        // Replies are Markdown; a real app would render it. Strip bold markers here.
        <Text style={mine ? styles.mineText : styles.theirsText}>
          {message.content.replace(/\*\*/g, "")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    backgroundColor: COLORS.pink,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 14,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: COLORS.white, fontWeight: "800", fontSize: 15 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%",
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.purple,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: COLORS.yellow, fontWeight: "900" },
  title: { fontWeight: "800", color: COLORS.navy },
  subtitle: { color: COLORS.grey, fontSize: 12 },
  close: { fontSize: 18, color: COLORS.grey, padding: 4 },
  list: { padding: 12, gap: 8 },
  suggestionRow: { flexGrow: 0, flexShrink: 0, maxHeight: 44 },
  suggestions: { paddingHorizontal: 10, gap: 8, alignItems: "center" },
  suggestion: {
    backgroundColor: COLORS.pinkLight,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  suggestionText: { color: COLORS.purple, fontWeight: "600" },
  error: { color: "#b00020", paddingHorizontal: 12 },
  bubble: { padding: 10, borderRadius: 14, maxWidth: "88%" },
  mine: { alignSelf: "flex-end", backgroundColor: COLORS.pink },
  mineText: { color: COLORS.white },
  theirs: { alignSelf: "flex-start", backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  theirsText: { color: COLORS.navy },
  inputRow: { flexDirection: "row", alignItems: "center", padding: 10, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: COLORS.navy,
    backgroundColor: COLORS.background,
  },
  sendButton: { backgroundColor: COLORS.purple, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: COLORS.white, fontWeight: "700" },
});
