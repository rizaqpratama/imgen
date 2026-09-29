import type { ImageUsage } from "./store.js";

/** Standard gpt-image-2.5-sunburst rates, USD per 1M tokens. */
const TEXT_INPUT_PER_MILLION = 5;
const IMAGE_INPUT_PER_MILLION = 8;
const OUTPUT_PER_MILLION = 30;

export type PublicImageUsage = ImageUsage & { costUsd: number };

export function imageCostUsd(usage: ImageUsage): number {
  const amount =
    (usage.textTokens * TEXT_INPUT_PER_MILLION +
      usage.imageTokens * IMAGE_INPUT_PER_MILLION +
      usage.outputTokens * OUTPUT_PER_MILLION) /
    1_000_000;
  return Math.round(amount * 1_000_000) / 1_000_000;
}

export function publishUsage(usage: ImageUsage): PublicImageUsage {
  return { ...usage, costUsd: imageCostUsd(usage) };
}
