import { AgoProvider } from "@useago/sdk/native";
import { fetch } from "expo/fetch";
import { Stack, usePathname, useRouter } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgoBridge } from "../src/AgoBridge";
import { Assistant } from "../src/Assistant";
import { StoreProvider } from "../src/store";
import { COLORS } from "../src/theme";
import { Logo } from "../src/ui";

// Keeps the visitor's anonymous id across launches (React Native has no
// localStorage). The SDK needs synchronous reads, hence the *Sync methods.
const storage = {
  getItem: (key: string) => Storage.getItemSync(key),
  setItem: (key: string, value: string) => Storage.setItemSync(key, value),
};

const TABS = [
  { path: "/", label: "Home" },
  { path: "/send", label: "Send" },
  { path: "/deliveries", label: "Deliveries" },
  { path: "/cagnotte", label: "Cagnotte" },
];

function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  // Clear the Android gesture bar even when the inset reports 0 (edge-to-edge).
  const { bottom } = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(bottom, 20) + 6 }]}>
      {TABS.map((tab) => {
        const active =
          tab.path === "/" ? pathname === "/" : pathname.startsWith(tab.path) ||
            (tab.path === "/deliveries" && pathname.startsWith("/delivery/"));
        return (
          <Pressable key={tab.path} style={styles.tab} onPress={() => router.navigate(tab.path)}>
            <View style={[styles.tabDot, active && { backgroundColor: COLORS.pink }]} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function RootLayout() {
  return (
    <AgoProvider
      // Swap for https://YOUR-DOMAIN.api.useago.com once you have a tenant.
      baseUrl="https://playground.api.useago.com"
      agent="generic-guide"
      // expo/fetch streams replies token by token; the built-in fetch cannot.
      fetch={fetch}
      storage={storage}
    >
      <StoreProvider>
        <AgoBridge />
        <View style={styles.root}>
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: COLORS.white },
              headerTintColor: COLORS.purple,
              headerTitleStyle: { color: COLORS.navy, fontWeight: "800" },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: COLORS.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerTitle: () => <Logo /> }} />
            <Stack.Screen name="send" options={{ title: "Send a parcel" }} />
            <Stack.Screen name="deliveries" options={{ title: "My deliveries" }} />
            <Stack.Screen name="delivery/[id]" options={{ title: "Tracking" }} />
            <Stack.Screen name="cagnotte" options={{ title: "Co-transporter" }} />
            <Stack.Screen name="sdk-test" options={{ title: "SDK test" }} />
          </Stack>
          <TabBar />
          <Assistant />
        </View>
      </StoreProvider>
    </AgoProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.white },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.white,
    paddingVertical: 8,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "transparent" },
  tabLabel: { fontSize: 12, color: COLORS.grey, fontWeight: "600" },
  tabLabelActive: { color: COLORS.purple },
});
