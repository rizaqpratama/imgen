import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageCostUsd } from "./pricing.js";

describe("imageCostUsd", () => {
  it("prices text input, image input, and output at Sunburst standard rates", () => {
    const cost = imageCostUsd({
      inputTokens: 100,
      textTokens: 10,
      imageTokens: 90,
      outputTokens: 1000,
      totalTokens: 1100,
    });

    assert.equal(cost, 0.03077);
  });
});