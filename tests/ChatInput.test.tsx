import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ChatInput } from "../src/react/components/ChatInput";
import { createMockClient } from "../src/testing/createMockClient";

it("updates labels from its client and retains explicit placeholders", async () => {
  let language = "fr";
  const client = createMockClient({ overrides: { getLanguage: () => language } });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ChatInput client={client} onSend={vi.fn()} />));
    expect(host.querySelector("textarea")?.placeholder).toBe("Écrivez un message...");
    await act(async () => {
      language = "it";
      client.__emitEvent("config:changed", { language });
    });
    expect(host.textContent).toContain("Invia");
    await act(async () => root.render(null));
    language = "es";
    client.__emitEvent("config:changed", { language });
    await act(async () => root.render(<ChatInput client={client} onSend={vi.fn()} placeholder="Host" />));
    expect(host.querySelector("textarea")?.placeholder).toBe("Host");
    expect(host.textContent).toContain("Enviar");
  } finally {
    await act(async () => root.unmount());
    client.destroy();
    host.remove();
  }
});
