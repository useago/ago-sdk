import { describe, expect, it } from "vitest";
import { computePrice } from "../examples/glacier/src/pricing";

describe("Glacier pricing", () => {
  it("does not charge toppings or a container before a scoop is selected", () => {
    expect(
      computePrice({
        cone: "cone",
        scoops: [],
        toppings: ["cherry", "whipped-cream"],
      }),
    ).toBe(0);
  });

  it("includes the container and toppings once the creation is orderable", () => {
    expect(
      computePrice({
        cone: "cone",
        scoops: ["vanilla"],
        toppings: ["cherry"],
      }),
    ).toBe(3.5);
  });
});
