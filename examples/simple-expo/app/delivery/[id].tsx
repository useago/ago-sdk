import { useAgoContext } from "@useago/sdk/native";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { SIZES, SLOTS, STATUS_LABELS, type Status } from "../../src/data";
import { useStore } from "../../src/store";
import { COLORS } from "../../src/theme";
import { Card, StatusPill, styles } from "../../src/ui";

const STEPS: Status[] = ["searching", "assigned", "picked_up", "delivered"];

export default function TrackingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deliveries } = useStore();
  const delivery = deliveries.find((d) => d.id === id);

  // What the assistant sees while the user looks at this delivery.
  useAgoContext(
    {
      name: "Delivery being tracked",
      data: delivery
        ? {
            ...delivery,
            status: STATUS_LABELS[delivery.status],
            insurance: "up to 2,500 EUR",
          }
        : { id, missing: true },
    },
    "tracked-delivery",
  );

  if (!delivery) {
    return <Text style={[styles.screen, { padding: 16 }]}>Delivery {id} not found.</Text>;
  }
  const current = STEPS.indexOf(delivery.status);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={{ color: COLORS.grey }}>{delivery.id}</Text>
        <Text style={styles.h1}>{delivery.description || "Parcel"}</Text>
        <StatusPill status={delivery.status} />
        {delivery.status !== "delivered" && delivery.status !== "searching" && (
          <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.pink }}>
            Arrives in about {delivery.etaMinutes} min
          </Text>
        )}
      </Card>

      {delivery.coTransporter && (
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: COLORS.purple,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Text style={{ color: COLORS.white, fontWeight: "800", fontSize: 18 }}>
              {delivery.coTransporter.name[0]}
            </Text>
          </View>
          <View>
            <Text style={styles.h2}>{delivery.coTransporter.name}</Text>
            <Text style={styles.muted}>
              {delivery.coTransporter.vehicle} · ★ {delivery.coTransporter.rating}
            </Text>
          </View>
        </Card>
      )}

      <Card>
        {STEPS.map((step, i) => (
          <View key={step} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: i <= current ? COLORS.pink : COLORS.border,
              }}
            />
            <Text style={{ color: i <= current ? COLORS.navy : COLORS.grey, fontWeight: i === current ? "700" : "400" }}>
              {STATUS_LABELS[step]}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <Text style={styles.label}>From</Text>
        <Text style={styles.muted}>{delivery.from}</Text>
        <Text style={styles.label}>To</Text>
        <Text style={styles.muted}>{delivery.to}</Text>
        <Text style={styles.label}>Details</Text>
        <Text style={styles.muted}>
          Size {delivery.size} ({SIZES[delivery.size].label}) · {SLOTS[delivery.slot]} ·{" "}
          {delivery.price.toFixed(2)} EUR · insured up to 2,500 EUR
        </Text>
      </Card>
    </ScrollView>
  );
}
