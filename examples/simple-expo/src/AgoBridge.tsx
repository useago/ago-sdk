import {
  useAgoAutoContinueAfterNavigation,
  useAgoContext,
  useAgoFunction,
  useAgoNavigation,
} from "@useago/sdk/native";
import { usePathname, useRouter } from "expo-router";
import {
  MAX_KM,
  SIZES,
  STATUS_LABELS,
  TOWNS,
  USER,
  quote,
  type Size,
} from "./data";
import { useStore } from "./store";

// Screens the assistant may open, by expo-router path.
const ROUTES = [
  { name: "home", path: "/", description: "Home screen" },
  {
    name: "send",
    path: "/send",
    description:
      "Delivery request form. Open it whenever the user wants to send a parcel; you can then fill its fields for them.",
  },
  { name: "deliveries", path: "/deliveries", description: "List of the user's deliveries" },
  {
    name: "tracking",
    path: "/delivery/:id",
    description: "Live tracking of one delivery (co-transporter, status, ETA), by delivery id like TT-4821",
  },
  {
    name: "cagnotte",
    path: "/cagnotte",
    description: "Co-transporter side: earnings (cagnotte) and deliveries available to book nearby",
  },
];

/** Everything the assistant knows and can do, app-wide. Render once inside the providers. */
export function AgoBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const { deliveries } = useStore();

  useAgoNavigation((path) => router.navigate(path), ROUTES, {
    getCurrentPath: () => pathname,
  });
  // "Send flowers to my mum" opens the form, then fills it in the same turn.
  useAgoAutoContinueAfterNavigation();

  useAgoContext(
    {
      name: "Tut Tut customer",
      description:
        "Tut Tut is a collaborative delivery service around Avignon: private co-transporters deliver parcels on their usual trips, within 2 hours, up to 30 km, insured up to 2,500 EUR.",
      data: { firstName: USER.firstName, savedAddresses: USER.savedAddresses },
    },
    "customer",
  );

  useAgoContext(
    {
      name: "My deliveries",
      data: {
        deliveries: deliveries.map((d) => ({
          id: d.id,
          to: d.to,
          description: d.description,
          status: STATUS_LABELS[d.status],
          etaMinutes: d.status === "delivered" ? undefined : d.etaMinutes,
          coTransporter: d.coTransporter?.name,
        })),
      },
    },
    "deliveries",
  );

  useAgoFunction({
    name: "getPriceQuote",
    description:
      "Price of a Tut Tut delivery from Avignon to a town, for a parcel size. Use it to answer 'how much' questions without opening the form.",
    parameters: {
      type: "object",
      properties: {
        size: {
          type: "string",
          enum: Object.keys(SIZES),
          description: Object.entries(SIZES)
            .map(([s, v]) => `${s}: ${v.examples}`)
            .join("; "),
        },
        town: { type: "string", enum: Object.keys(TOWNS), description: "Destination town" },
      },
      required: ["size", "town"],
    },
    handler: async (args) => {
      const size = args.size as Size;
      const town = args.town as string;
      const q = quote(size, town);
      return q.inZone
        ? { price: `${q.price.toFixed(2)} EUR`, distanceKm: q.km, delivery: "within 2 hours", insurance: "up to 2,500 EUR" }
        : { available: false, reason: `${town} is ${q.km} km away; Tut Tut delivers within ${MAX_KM} km.` };
    },
  });

  return null;
}
