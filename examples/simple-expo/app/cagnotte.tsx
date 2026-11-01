import { useAgoContext, useAgoPageState } from "@useago/sdk/native";
import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { AVAILABLE_JOBS } from "../src/data";
import { COLORS } from "../src/theme";
import { Button, Card, styles } from "../src/ui";

export default function CagnotteScreen() {
  const [available, setAvailable] = useState(true);
  const [booked, setBooked] = useState<string[]>([]);

  // "Which delivery pays the most on my way to Carpentras?"
  useAgoContext(
    { name: "Deliveries available to book", data: { jobs: AVAILABLE_JOBS, booked } },
    "available-jobs",
  );
  useAgoPageState([
    {
      name: "availableNow",
      description: "Whether the co-transporter is available to receive delivery offers",
      schema: { type: "boolean" },
      get: () => available,
      set: (value) => setAvailable(value as boolean),
    },
  ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ backgroundColor: COLORS.navy, borderRadius: 20, padding: 20, gap: 4 }}>
        <Text style={{ color: COLORS.pinkLight }}>My cagnotte</Text>
        <Text style={{ color: COLORS.white, fontSize: 34, fontWeight: "800" }}>182.40 EUR</Text>
        <Text style={{ color: COLORS.pinkLight }}>14 deliveries this month · paid to your bank account</Text>
      </View>

      <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.h2}>Available now</Text>
        <Switch
          value={available}
          onValueChange={setAvailable}
          trackColor={{ true: COLORS.pink, false: COLORS.border }}
          thumbColor={COLORS.white}
        />
      </Card>

      <Text style={styles.h2}>Deliveries near you</Text>
      {AVAILABLE_JOBS.map((job) => (
        <Card key={job.id}>
          <Text style={{ fontWeight: "700", color: COLORS.navy }}>
            {job.from} → {job.to}
          </Text>
          <Text style={styles.muted}>
            Size {job.size} · pickup in {job.pickupIn}
          </Text>
          <Text style={{ color: COLORS.pink, fontWeight: "800", fontSize: 18 }}>+{job.earnings.toFixed(2)} EUR</Text>
          <Button
            title={booked.includes(job.id) ? "Booked" : "Book this delivery"}
            variant={booked.includes(job.id) ? "secondary" : "primary"}
            disabled={!available}
            onPress={() => setBooked((b) => (b.includes(job.id) ? b : [...b, job.id]))}
          />
        </Card>
      ))}
    </ScrollView>
  );
}
