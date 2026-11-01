import { useAgoPageState } from "@useago/sdk/native";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SIZES, SLOTS, USER, quote, resolveAddress, townOf, type Size, type Slot } from "../src/data";
import { useStore } from "../src/store";
import { COLORS } from "../src/theme";
import { Button, Card, styles } from "../src/ui";

const SIZE_GUIDE = Object.entries(SIZES)
  .map(([size, s]) => `${size} (${s.label}): ${s.examples}`)
  .join("; ");

export default function SendScreen() {
  const router = useRouter();
  const { draft, updateDraft, confirmDraft } = useStore();
  const town = townOf(draft.to);
  const q = quote(draft.size, town);
  const ready = draft.from.trim() !== "" && draft.to.trim() !== "" && q.inZone;

  // The assistant fills this form from a plain-language request. The user
  // reviews it and taps Confirm: the assistant never books on its own.
  useAgoPageState(
    [
      {
        name: "pickupAddress",
        description: `Where the co-transporter picks the parcel up. Saved addresses (pass the full address, or just home, shop or mum): ${JSON.stringify(USER.savedAddresses)}`,
        schema: { type: "string" },
        clearable: true,
        get: () => draft.from,
        set: (value) => updateDraft({ from: resolveAddress(value as string) }),
      },
      {
        name: "dropoffAddress",
        description: "Where the parcel is delivered, with the town name. Same saved addresses as pickupAddress (home, shop, mum).",
        schema: { type: "string" },
        clearable: true,
        get: () => draft.to,
        set: (value) => updateDraft({ to: resolveAddress(value as string) }),
      },
      {
        name: "parcelSize",
        description: `Smallest size the item fits in. ${SIZE_GUIDE}`,
        schema: { type: "string", enum: Object.keys(SIZES) },
        get: () => draft.size,
        set: (value) => updateDraft({ size: value as Size }),
      },
      {
        name: "description",
        description: "What is being sent, in a few words (helps the co-transporter).",
        schema: { type: "string" },
        clearable: true,
        get: () => draft.description,
        set: (value) => updateDraft({ description: value as string }),
      },
      {
        name: "timeSlot",
        description: `When to deliver: ${JSON.stringify(SLOTS)}`,
        schema: { type: "string", enum: Object.keys(SLOTS) },
        get: () => draft.slot,
        set: (value) => updateDraft({ slot: value as Slot }),
      },
    ],
    {
      data: {
        description:
          "The resulting quote. The user must review the form and tap Confirm to book; tell them so.",
        get: () => ({ price: `${q.price.toFixed(2)} EUR`, distanceKm: q.km, inZone: q.inZone, readyToConfirm: ready }),
      },
    },
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.label}>Pickup address</Text>
        <Field value={draft.from} onChange={(from) => updateDraft({ from })} placeholder="Where do we pick it up?" />
        <Text style={styles.label}>Delivery address</Text>
        <Field value={draft.to} onChange={(to) => updateDraft({ to })} placeholder="Where does it go?" />
        <Text style={styles.label}>What are you sending?</Text>
        <Field
          value={draft.description}
          onChange={(description) => updateDraft({ description })}
          placeholder="e.g. a bouquet of flowers"
        />
      </Card>

      <Card>
        <Text style={styles.label}>Parcel size</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(Object.keys(SIZES) as Size[]).map((size) => (
            <Chip key={size} active={draft.size === size} onPress={() => updateDraft({ size })}>
              {size}
            </Chip>
          ))}
        </View>
        <Text style={styles.muted}>{SIZES[draft.size].examples}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>When</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(Object.keys(SLOTS) as Slot[]).map((slot) => (
            <Chip key={slot} active={draft.slot === slot} onPress={() => updateDraft({ slot })}>
              {SLOTS[slot].replace(" (within 2 hours)", "")}
            </Chip>
          ))}
        </View>
      </Card>

      <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={styles.muted}>{q.inZone ? `${q.km} km · insured up to 2,500 EUR` : `Out of zone (${q.km} km)`}</Text>
          <Text style={{ fontSize: 24, fontWeight: "800", color: COLORS.navy }}>
            {q.inZone ? `${q.price.toFixed(2)} EUR` : "Unavailable"}
          </Text>
        </View>
      </Card>

      <Button
        title="Confirm delivery"
        disabled={!ready}
        onPress={() => router.replace(`/delivery/${confirmDraft()}`)}
      />
    </ScrollView>
  );
}

function Field(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChange}
      placeholder={props.placeholder}
      placeholderTextColor={COLORS.grey}
      multiline
      style={{
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        color: COLORS.navy,
        backgroundColor: COLORS.background,
      }}
    />
  );
}

function Chip(props: { active: boolean; onPress: () => void; children: string }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: props.active ? COLORS.pink : COLORS.border,
        backgroundColor: props.active ? COLORS.pink : COLORS.white,
      }}
    >
      <Text style={{ color: props.active ? COLORS.white : COLORS.navy, fontWeight: "600" }}>
        {props.children}
      </Text>
    </Pressable>
  );
}
