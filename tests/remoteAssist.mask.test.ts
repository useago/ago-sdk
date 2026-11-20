import { describe, expect, it } from "vitest";
import { applyMask, findMaskTargets, maskSelector } from "../src/remoteAssist/mask";
import { capState, pageUrl } from "../src/remoteAssist/pageContext";
import { encodeUnderLimit } from "../src/remoteAssist/screenshot";

function fixture(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const ids = (elements: Element[]) => elements.map((el) => el.id);

describe("screenshot masking", () => {
  it("selects passwords, data-ago-mask, card and one-time-code fields, and configured selectors", () => {
    const root = fixture(`
      <input id="pw" type="PASSWORD">
      <div id="flagged" data-ago-mask><span id="inner">IBAN</span></div>
      <input id="cc" autocomplete="billing cc-number">
      <input id="exp" autocomplete="section-pay CC-EXP">
      <input id="otp" autocomplete="one-time-code">
      <input id="email" autocomplete="email">
      <input id="name" autocomplete="name">
      <p id="iban" class="iban">FR76...</p>
      <p id="plain">hello</p>
    `);
    const targets = ids(findMaskTargets(root, maskSelector([".iban", "  "])));
    expect(targets.sort()).toEqual(["cc", "exp", "flagged", "iban", "otp", "pw"]);
  });

  it("includes the root itself when it matches", () => {
    const root = fixture("");
    root.id = "self";
    root.setAttribute("data-ago-mask", "");
    expect(ids(findMaskTargets(root, maskSelector()))).toEqual(["self"]);
  });

  it("fails closed on a selector that does not parse", () => {
    expect(() => maskSelector(["div >>> p"])).toThrowError(
      expect.objectContaining({ code: "remote_assist_invalid_mask" }),
    );
  });

  it("hides the content of a masked field but keeps its box", () => {
    const root = fixture(`
      <input id="pw" type="password" value="hunter2" placeholder="Password">
      <div id="card" data-ago-mask style="width: 120px"><b>4242</b></div>
      <img id="photo" data-ago-mask src="x.png" style="width: 40px">
    `);
    for (const el of findMaskTargets(root, maskSelector())) applyMask(el);

    const pw = root.querySelector<HTMLInputElement>("#pw")!;
    expect(pw.value).toBe("");
    expect(pw.getAttribute("value")).toBe("");
    expect(pw.hasAttribute("placeholder")).toBe(false);
    expect(pw.style.getPropertyPriority("color")).toBe("important");

    const card = root.querySelector<HTMLElement>("#card")!;
    expect(card.style.width).toBe("120px");
    expect(card.querySelector("b")!.style.visibility).toBe("hidden");

    // Replaced content (an image) cannot be hidden by colour: it is swapped out.
    expect(root.querySelector("img")).toBeNull();
    const block = root.lastElementChild as HTMLElement;
    expect(block.tagName).toBe("DIV");
    expect(block.style.width).toBe("40px");
  });
});

describe("page context", () => {
  it("drops a hash that carries parameters, keeps a hash route", () => {
    expect(pageUrl({ href: "https://a.test/cb#access_token=x&s=1", hash: "#access_token=x&s=1" })).toBe(
      "https://a.test/cb",
    );
    expect(pageUrl({ href: "https://a.test/#/orders/42", hash: "#/orders/42" })).toBe(
      "https://a.test/#/orders/42",
    );
  });

  it("keeps the state keys that fit under the cap and flags the cut", () => {
    const state = { small: 1, big: "x".repeat(200), after: 2 };
    expect(capState(state, 1000)).toBe(state);
    expect(capState(state, 60)).toEqual({ _truncated: true, small: 1, after: 2 });
    expect(capState("y".repeat(100), 60)).toEqual({ _truncated: true, originalBytes: 102 });
  });
});

describe("screenshot encoding", () => {
  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    return c;
  };

  it("falls back to a smaller format, skipping one the browser cannot encode", async () => {
    const tried: string[] = [];
    const blob = await encodeUnderLimit(canvas(), 100, async (_c, type) => {
      tried.push(type);
      if (type === "image/png") return new Blob(["x".repeat(500)], { type });
      if (type === "image/webp") return new Blob(["x"], { type: "image/png" }); // no WebP encoder
      return new Blob(["x".repeat(50)], { type });
    });
    expect(tried).toEqual(["image/png", "image/webp", "image/jpeg"]);
    expect(blob.type).toBe("image/jpeg");
  });

  it("downscales before giving up, and throws when nothing fits", async () => {
    const sizes: number[] = [];
    const blob = await encodeUnderLimit(canvas(), 100, async (c, type) => {
      sizes.push(c.width);
      return new Blob(["x".repeat(c.width < 800 ? 10 : 500)], { type });
    });
    expect(blob.size).toBe(10);
    expect(sizes.at(-1)).toBe(400);

    await expect(
      encodeUnderLimit(canvas(), 1, async (_c, type) => new Blob(["xx"], { type })),
    ).rejects.toMatchObject({ code: "remote_assist_screenshot_too_large" });
  });
});
