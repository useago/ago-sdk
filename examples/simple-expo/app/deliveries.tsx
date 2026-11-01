import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { useStore } from "../src/store";
import { COLORS } from "../src/theme";
import { Card, StatusPill, styles } from "../src/ui";

export default function DeliveriesScreen() {
  const router = useRouter();
  const { deliveries } = useStore();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {deliveries.map((d) => (
        <Pressable key={d.id} onPress={() => router.navigate(`/delivery/${d.id}`)}>
          <Card>
            <Text style={{ color: COLORS.grey, fontSize: 12 }}>{d.id}</Text>
            <Text style={styles.h2}>{d.description || "Parcel"}</Text>
            <Text style={styles.muted}>To {d.to}</Text>
            <StatusPill status={d.status} />
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
