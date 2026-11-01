import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import type { Status } from "./data";
import { STATUS_LABELS } from "./data";
import { COLORS } from "./theme";

/** Text logo in Tut Tut's style (wordmark + pink/yellow tag). */
export function Logo() {
  return (
    <View style={styles.logo}>
      <Text style={styles.logoText}>Tut Tut</Text>
      <View style={styles.logoTag}>
        <View style={styles.logoTagInner} />
      </View>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text style={[styles.buttonText, variant === "secondary" && { color: COLORS.purple }]}>
        {title}
      </Text>
    </Pressable>
  );
}

const STATUS_COLORS: Record<Status, string> = {
  searching: COLORS.yellow,
  assigned: COLORS.pink,
  picked_up: COLORS.purple,
  delivered: COLORS.green,
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <View style={[styles.pill, { backgroundColor: STATUS_COLORS[status] }]}>
      <Text style={[styles.pillText, status === "searching" && { color: COLORS.navy }]}>
        {STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  logo: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoText: { fontSize: 24, fontWeight: "900", color: COLORS.purple, letterSpacing: -0.5 },
  logoTag: {
    width: 22,
    height: 18,
    borderRadius: 5,
    backgroundColor: COLORS.pink,
    transform: [{ rotate: "-8deg" }],
    justifyContent: "center",
    alignItems: "center",
  },
  logoTagInner: { width: 12, height: 10, borderRadius: 3, backgroundColor: COLORS.yellow },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  button: {
    backgroundColor: COLORS.pink,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonSecondary: { backgroundColor: COLORS.pinkLight },
  buttonText: { color: COLORS.white, fontWeight: "700", fontSize: 16 },
  pill: { alignSelf: "flex-start", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: COLORS.white, fontSize: 12, fontWeight: "600" },
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, gap: 14, paddingBottom: 120 },
  h1: { fontSize: 26, fontWeight: "800", color: COLORS.navy },
  h2: { fontSize: 18, fontWeight: "700", color: COLORS.navy },
  muted: { color: COLORS.grey },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.navy, marginTop: 4 },
});
