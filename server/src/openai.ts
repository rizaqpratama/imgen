import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { mimeForExt, type ImageExt, type ImageUsage } from "./store.js";

export const MODEL = "gpt-image-2.5-sunburst";
export const QUALITIES = ["low", "medium", "high", "xhigh", "max"] as const;
export const SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;
export const TURNAROUND_SIZE = "2048x1024";
/** GPT Image `images.edit` accepts at most 16 png, jpeg, or webp inputs. */
export const MAX_REFERENCE_IMAGES = 16;

export type Quality = (typeof QUALITIES)[number];
export type Size = (typeof SIZES)[number];

export function isQuality(value: string): value is Quality {
  return (QUALITIES as readonly string[]).includes(value);
}

export function isSize(value: string): value is Size {
  return (SIZES as readonly string[]).includes(value);
}

type ImageInput = {
  bytes?: Buffer;
  filePath?: string;
  filename: string;
  ext: ImageExt;
};

export function turnaroundPrompt(name: string, description: string, referenceCount: number): string {
  const parts = [
    `Create a professional character turnaround sheet for "${name}".`,
    description.trim(),
    referenceNote(referenceCount),
    "Layout: one wide sheet, full body, four views left to right — front, three-quarter, side profile, back. Same character, same outfit, same proportions, same colors in every view. Neutral light-gray studio background, even lighting, no scenery, no extra characters, no text labels.",
  ];
  return parts.filter(Boolean).join("\n\n");
}

function referenceNote(count: number): string {
  if (count <= 0) return "";
  if (count === 1) {
    return "Image 1 is the character reference. Match identity, face, outfit, and colors from that reference.";
  }
  return `Images 1 through ${count} are references of the same character. Match identity, face, outfit, and colors from every reference.`;
}

export function composePrompt(
  userPrompt: string,
  options: { hasSource: boolean; referenceCount: number },
): string {
  const notes: string[] = [];
  if (options.hasSource) {
    notes.push(
      "Image 1 is the image to edit. Change only what the instruction asks. Keep everything else intact.",
    );
    if (options.referenceCount > 0) {
      notes.push(referenceLine(2, options.referenceCount));
    }
  } else if (options.referenceCount > 0) {
    notes.push(referenceLine(1, options.referenceCount));
  }
  notes.push(userPrompt.trim());
  return notes.join("\n\n");
}

function referenceLine(start: number, count: number): string {
  const labels = Array.from({ length: count }, (_, index) => `image ${start + index}`);
  const list =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  const verb = count === 1 ? "is a character turnaround reference" : "are character turnaround references";
  return `${list} ${verb}. Preserve that character's identity, outfit, and colors.`;
}

function clientFor(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 });
}

export async function testKey(apiKey: string): Promise<void> {
  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  await client.models.retrieve(MODEL);
}

export async function createImage(options: {
  apiKey: string;
  prompt: string;
  quality: string;
  size: string;
  images: ImageInput[];
}): Promise<{ bytes: Buffer; usage: ImageUsage | null }> {
  const client = clientFor(options.apiKey);
  const quality = options.quality as "low" | "medium" | "high";
  const size = options.size;

  if (options.images.length === 0) {
    const result = await client.images.generate({
      model: MODEL,
      prompt: options.prompt,
      size,
      quality,
      output_format: "png",
      n: 1,
    });
    return { bytes: decodeImage(result.data?.[0]?.b64_json), usage: parseImageUsage(result.usage) };
  }

  const files = await Promise.all(options.images.map((image) => asUpload(image)));
  const result = await client.images.edit({
    model: MODEL,
    image: files,
    prompt: options.prompt,
    size,
    quality,
    output_format: "png",
    n: 1,
  });
  return { bytes: decodeImage(result.data?.[0]?.b64_json), usage: parseImageUsage(result.usage) };
}

export function parseImageUsage(value: unknown): ImageUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = numberField(usage.input_tokens);
  const outputTokens = numberField(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const details =
    typeof usage.input_tokens_details === "object" && usage.input_tokens_details !== null
      ? (usage.input_tokens_details as Record<string, unknown>)
      : null;
  const textTokens = details ? numberField(details.text_tokens) : null;
  const imageTokens = details ? numberField(details.image_tokens) : null;
  return {
    inputTokens,
    textTokens: textTokens ?? inputTokens,
    imageTokens: imageTokens ?? 0,
    outputTokens,
    totalTokens: numberField(usage.total_tokens) ?? inputTokens + outputTokens,
  };
}

async function asUpload(image: ImageInput) {
  const type = mimeForExt(image.ext);
  const bytes = image.bytes ?? fs.readFileSync(image.filePath ?? "");
  return toFile(bytes, image.filename, { type });
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function decodeImage(b64: string | undefined): Buffer {
  if (!b64) throw new Error("The model returned no image.");
  return Buffer.from(b64, "base64");
}
