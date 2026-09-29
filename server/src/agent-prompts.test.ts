import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentPlan } from "./store.js";
import { buildExecutionPrompt, mergeReferenceIds } from "./agent-prompts.js";

describe("mergeReferenceIds", () => {
  it("preserves pinned order, appends valid selections, deduplicates", () => {
    assert.deepEqual(
      mergeReferenceIds(["pinned"], ["agent", "pinned", "missing"], new Set(["pinned", "agent"])),
      ["pinned", "agent"],
    );
  });

  it("removes invalid pinned IDs and preserves valid pinned order", () => {
    assert.deepEqual(
      mergeReferenceIds(["alpha", "stale-pin", "beta"], ["gamma"], new Set(["alpha", "beta", "gamma"])),
      ["alpha", "beta", "gamma"],
    );
  });
});

describe("buildExecutionPrompt", () => {
  const plan: AgentPlan = {
    summary: "Edit the scene",
    expandedPrompt: "Place Mina on a rooftop at golden hour.",
    scene: "Rooftop cityscape, warm light, three-quarter view.",
    preserve: ["face identity", "outfit colors"],
    referenceIds: ["mina"],
  };

  it("labels canvas and character references when editing", () => {
    assert.match(
      buildExecutionPrompt(plan, [{ id: "mina", name: "Mina" }], true),
      /Image 1 is the current canvas[\s\S]*Image 2 is the character reference for "Mina"/,
    );
  });

  it("includes approved prompt, scene, and preservation constraints", () => {
    const prompt = buildExecutionPrompt(plan, [{ id: "mina", name: "Mina" }], true);
    assert.match(prompt, /Place Mina on a rooftop at golden hour\./);
    assert.match(prompt, /Rooftop cityscape, warm light, three-quarter view\./);
    assert.match(prompt, /face identity/);
    assert.match(prompt, /outfit colors/);
  });
});
