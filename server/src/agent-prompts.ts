import type { AgentPlan } from "./store.js";

export function mergeReferenceIds(
  pinnedIds: string[],
  selectedIds: string[],
  validIds: Set<string>,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const id of pinnedIds) {
    if (!validIds.has(id) || seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }

  for (const id of selectedIds) {
    if (!validIds.has(id) || seen.has(id)) continue;
    merged.push(id);
    seen.add(id);
  }

  return merged;
}

export function buildExecutionPrompt(
  plan: AgentPlan,
  references: Array<{ id: string; name: string }>,
  hasCurrentImage: boolean,
): string {
  const lines: string[] = ["Image ordering:"];
  let index = 1;

  if (hasCurrentImage) {
    lines.push(`Image ${index} is the current canvas`);
    index += 1;
  }

  for (const reference of references) {
    lines.push(`Image ${index} is the character reference for "${reference.name}"`);
    index += 1;
  }

  lines.push("", "Approved prompt:", plan.expandedPrompt, "", "Scene:", plan.scene);

  if (plan.preserve.length > 0) {
    lines.push("", "Preserve unchanged:");
    for (const item of plan.preserve) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}
