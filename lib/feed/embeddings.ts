import { Worker } from "node:worker_threads";

import { getGretelConfig } from "./config";
import { normalizeVector } from "./vector-math";

export type EmbeddingProvider = {
  embedTexts(texts: string[]): Promise<number[][]>;
};

export function createEmbeddingInput(video: { title: string; author: string; query: string }) {
  return [video.title, video.author, video.query].filter(Boolean).join("\n");
}

export function getEmbeddingProvider(config = getGretelConfig()): EmbeddingProvider {
  if (config.embeddings.provider === "local") {
    return new LocalEmbeddingProvider(config.embeddings.model, config.embeddings.requestTimeoutMs);
  }

  if (config.embeddings.provider === "mock" || !process.env[config.embeddings.openRouterApiKeyEnv]) {
    return new MockEmbeddingProvider(config.embeddings.dimensions, config.embeddings.mockSeed);
  }

  return new OpenRouterEmbeddingProvider(
    config.embeddings.openRouterBaseUrl,
    process.env[config.embeddings.openRouterApiKeyEnv] || "",
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

class LocalEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly model: string,
    private readonly timeoutMs: number
  ) {}

  async embedTexts(texts: string[]) {
    if (texts.length === 0) {
      return [];
    }

    return localEmbeddingWorker.embedTexts(this.model, texts, this.timeoutMs);
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

const localEmbeddingWorker = new class {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (vectors: number[][]) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private queue = Promise.resolve();

  embedTexts(model: string, texts: string[], timeoutMs: number) {
    const run = () => this.post(model, texts, timeoutMs);
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private post(model: string, texts: string[], timeoutMs: number) {
    this.ensureWorker();
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<number[][]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Local embedding request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.worker?.postMessage({ id, model, texts });
    });
  }

  private ensureWorker() {
    if (this.worker) {
      return;
    }

    this.worker = new Worker(localEmbeddingWorkerSource, { eval: true });
    this.worker.on("message", (message: WorkerResponse) => {
      const pending = this.pending.get(message.id);

      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error));
        return;
      }

      pending.resolve(message.vectors || []);
    });
    this.worker.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
    this.worker.on("exit", (code) => {
      const error = new Error(`Local embedding worker exited with code ${code}`);
      this.worker = null;

      if (code !== 0) {
        this.rejectAll(error);
      }
    });
  }

  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}();

type WorkerResponse = {
  id: number;
  vectors?: number[][];
  error?: string;
};

const localEmbeddingWorkerSource = `
  const { parentPort } = require("node:worker_threads");

  let pipelinePromise;
  const extractors = new Map();

  async function getPipeline() {
    if (!pipelinePromise) {
      pipelinePromise = import("@huggingface/transformers").then((module) => module.pipeline);
    }

    return pipelinePromise;
  }

  async function getExtractor(model) {
    if (!extractors.has(model)) {
      extractors.set(model, getPipeline().then((pipeline) => pipeline("feature-extraction", model)));
    }

    return extractors.get(model);
  }

  parentPort.on("message", async (message) => {
    try {
      const extractor = await getExtractor(message.model);
      const output = await extractor(message.texts, { pooling: "mean", normalize: true });
      parentPort.postMessage({ id: message.id, vectors: output.tolist() });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
`;

function positiveHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
