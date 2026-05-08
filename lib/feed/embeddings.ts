import { getGretelConfig } from "./config";
import { loadDotEnvFile } from "../env";
import { normalizeVector } from "./vector-math";

export type EmbeddingProvider = {
  embedTexts(texts: string[]): Promise<number[][]>;
};

export function createEmbeddingInput(video: { title: string; author: string; query: string }) {
  return [video.title, video.author, video.query].filter(Boolean).join("\n");
}

export function getEmbeddingProvider(config = getGretelConfig()): EmbeddingProvider {
  loadDotEnvFile();

  if (config.embeddings.provider === "mock") {
    return new MockEmbeddingProvider(config.embeddings.dimensions, config.embeddings.mockSeed);
  }

  const apiKey = process.env[config.embeddings.openRouterApiKeyEnv] || "";

  if (!apiKey) {
    throw new Error(
      `Missing OpenRouter API key in environment variable ${config.embeddings.openRouterApiKeyEnv}`
    );
  }

  return new OpenRouterEmbeddingProvider(
    config.embeddings.openRouterBaseUrl,
    apiKey,
    config.embeddings.model,
    config.embeddings.dimensions,
    process.env[config.embeddings.openRouterSiteUrlEnv] || "",
    process.env[config.embeddings.openRouterAppNameEnv] || "",
    config.embeddings.requestTimeoutMs
  );
}

class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dimensions: number,
    private readonly siteUrl: string,
    private readonly appName: string,
    private readonly timeoutMs: number
  ) {}

  async embedTexts(texts: string[]) {
    if (texts.length === 0) {
      return [];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(this.siteUrl ? { "HTTP-Referer": this.siteUrl } : {}),
          ...(this.appName ? { "X-Title": this.appName } : {})
        },
        body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`OpenRouter embedding request failed with ${response.status}`);
      }

      const payload = await response.json() as {
        data?: Array<{ embedding?: number[] }>;
      };

      return (payload.data || []).map((item) => normalizeVector(item.embedding || []));
    } finally {
      clearTimeout(timeout);
    }
  }
}

class MockEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly dimensions: number,
    private readonly seed: number
  ) {}

  async embedTexts(texts: string[]) {
    return texts.map((text) => this.embedText(text));
  }

  private embedText(text: string) {
    const vector = Array.from({ length: this.dimensions }, () => 0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [text.toLowerCase()];

    for (const token of tokens) {
      const index = positiveHash(`${this.seed}:${token}`) % this.dimensions;
      vector[index] += 1;
    }

    return normalizeVector(vector);
  }
}

function positiveHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
