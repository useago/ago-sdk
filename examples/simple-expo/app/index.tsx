import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { USER } from "../src/data";
import { useStore } from "../src/store";
import { COLORS } from "../src/theme";
import { Button, Card, StatusPill, styles } from "../src/ui";

export default function HomeScreen() {
  const router = useRouter();
  const { deliveries } = useStore();
  const active = deliveries.find((d) => d.status !== "delivered");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={{ backgroundColor: COLORS.purple, borderRadius: 20, padding: 20, gap: 10 }}>
        <Text style={{ color: COLORS.white, fontSize: 15 }}>Hello {USER.firstName} 👋</Text>
        <Text style={{ color: COLORS.white, fontSize: 26, fontWeight: "800" }}>
          Your parcel delivered within 2 hours
        </Text>
        <Text style={{ color: COLORS.pinkLight }}>
          By a co-transporter already making the trip. Insured up to 2,500 EUR.
        </Text>
        <Button title="Send a parcel" onPress={() => router.navigate("/send")} />
      </View>

      {active && (
        <Pressable onPress={() => router.navigate(`/delivery/${active.id}`)}>
          <Card>
            <Text style={styles.h2}>Delivery in progress</Text>
            <Text style={styles.muted}>
              {active.description} · to {active.to}
            </Text>
            <StatusPill status={active.status} />
            {active.status !== "searching" && (
              <Text style={{ color: COLORS.navy, fontWeight: "600" }}>
                Arrives in about {active.etaMinutes} min
              </Text>
            )}
          </Card>
        </Pressable>
      )}

      <Card style={{ backgroundColor: COLORS.pinkLight, borderColor: COLORS.pinkLight }}>
        <Text style={styles.h2}>Become a co-transporter</Text>
        <Text style={{ color: COLORS.navy }}>
          Deliver on your usual trips and earn up to 250 EUR a month.
        </Text>
        <Button title="See my cagnotte" variant="secondary" onPress={() => router.navigate("/cagnotte")} />
      </Card>

      <Card>
        <Text style={styles.h2}>Need help?</Text>
        <Text style={styles.muted}>
          Tap the assistant and describe what you need: "send flowers from my shop to my mum this
          afternoon". It fills the form for you.
        </Text>
      </Card>
    </ScrollView>
  );
}
