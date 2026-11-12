import React from "react";
import { createRoot } from "react-dom/client";
import { AgoClient } from "../../src/client/AgoClient";
import { ChatWidget } from "../../src/react/components/ChatWidget";

const client = new AgoClient({ baseUrl: location.origin });
createRoot(document.getElementById("root")!).render(
  <ChatWidget client={client} conversationId="11111111-1111-4111-8111-111111111111" height="min(85dvh, 700px)" />,
);
