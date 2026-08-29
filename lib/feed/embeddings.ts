import { getGretelConfig } from "./config";
import { loadDotEnvFile } from "../env";
import { getUserSettings } from "../settings";
import { normalizeVector } from "./vector-math";

export type EmbeddingProvider = {
  provider?: "openrouter" | "mock";
  model?: string;
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

  const settings = getUserSettings();
  const apiKey = settings.openRouterApiKey ||
    process.env[config.embeddings.openRouterApiKeyEnv] ||
    process.env.OPENROUTER_KEY ||
    process.env.ROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    "";

  if (!apiKey) {
    throw new Error(
      `Missing OpenRouter API key in ${config.embeddings.openRouterApiKeyEnv}, OPENROUTER_KEY, ROUTER_API_KEY, or user settings`
    );
  }

  return new OpenRouterEmbeddingProvider(
    config.embeddings.openRouterBaseUrl,
    apiKey,
    settings.openRouterModel || config.embeddings.model,
    config.embeddings.dimensions,
    process.env[config.embeddings.openRouterSiteUrlEnv] || "",
    process.env[config.embeddings.openRouterAppNameEnv] || "",
    config.embeddings.requestTimeoutMs
  );
}

class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openrouter" as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
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
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const data = [...(payload.data || [])].sort(
        (left, right) => (left.index ?? 0) - (right.index ?? 0)
      );

      if (data.length !== texts.length) {
        throw new Error(
          `OpenRouter returned ${data.length} embeddings for ${texts.length} inputs`
        );
      }

      return data.map((item, index) => {
        const vector = normalizeVector(item.embedding || []);

        if (vector.length !== this.dimensions) {
          throw new Error(
            `OpenRouter embedding ${index} has ${vector.length} dimensions; expected ${this.dimensions}`
          );
        }

        return vector;
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "mock" as const;
  readonly model = "mock/hash-v1";

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
