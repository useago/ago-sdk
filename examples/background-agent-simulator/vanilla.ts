import { AgoClient } from "../../src/client/AgoClient";
import { mountChatWidget } from "../../src/widget/createChatWidget";
const client = new AgoClient({ baseUrl: location.origin, userJwt: "synthetic" });
const ordinary = new URLSearchParams(location.search).has("ordinary");
mountChatWidget(document.querySelector("#widget")!, { client, placement: "bubble", defaultOpen: true, ...(ordinary ? {} : { conversationId: "11111111-1111-4111-8111-111111111111" }), autoResume: false, loadThreads: false, welcomeMessage: "" });
