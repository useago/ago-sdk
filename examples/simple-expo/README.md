# simple-expo: a Tut Tut-style delivery app with an AI assistant

React Native (Expo + expo-router) demo of `@useago/sdk/native`, styled after
[Tut Tut](https://www.tut-tut.com/en/), the collaborative delivery service: parcels
delivered within 2 hours by co-transporters already making the trip.

Screens: Home, Send a parcel (S/M/L/XL, time slot, quote), My deliveries, live
Tracking, and the co-transporter Cagnotte. Prices, people and addresses are made up.

The assistant (pink "Ask Tut Tut" button) helps where users get stuck:

| Ask | What happens |
| --- | --- |
| "Send flowers from my shop to my mum this afternoon" | Opens the form and fills it: saved addresses, the right size, the slot. The user only taps Confirm |
| "Where is my parcel?" | Answers from the live tracking (co-transporter, step, ETA) |
| "How much to send a fridge to Carpentras?" | Picks the size (XL) and quotes it with the app's own price grid |
| "Which delivery pays the most for me?" | Opens the Cagnotte and compares the deliveries available nearby |

How it is wired:

- `app/_layout.tsx`: `AgoProvider` with `expo/fetch` (streaming) and a persisted visitor id
- `src/AgoBridge.tsx`: the screens the assistant can open (`useAgoNavigation`), what it
  knows (`useAgoContext`: customer, saved addresses, deliveries) and a `getPriceQuote` tool
- `app/send.tsx`: the form fields the assistant can fill (`useAgoPageState`). It never
  books on its own: the user confirms
- `src/Assistant.tsx`: the chat, built on `useChat`

It talks to the public playground (`https://playground.api.useago.com`, agent
`generic-guide`), so it answers with no signup.

## Run it

`@useago/sdk/native` is not published yet, so the app installs a tarball of the
local build:

```bash
npm run sdk        # build the SDK at the repo root, pack it here, install everything
npm start          # then scan the QR code with Expo Go (Android or iOS)
```

`npm run android` opens it in an Android emulator instead (needs the Android SDK).
If the emulator cannot reach Metro, run `adb reverse tcp:8081 tcp:8081` and start with
`npx expo start --android --localhost`.

After changing the SDK source, run `npm run sdk` again.
