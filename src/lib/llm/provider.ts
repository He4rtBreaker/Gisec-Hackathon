import type { EnvKey } from "../domain";

/**
 * Single seam through which every model call in Mizan passes.
 *
 * Each execution environment — and the on-prem inspector — has its own
 * binding. By default all of them point at the same local Ollama daemon;
 * `MIZAN_PROVIDER_<BINDING>` (and `OLLAMA_HOST_<BINDING>`, `OLLAMA_MODEL_<BINDING>`,
 * `ANTHROPIC_MODEL_<BINDING>`) move any one of them elsewhere.
 *
 * Every binding also carries a network boundary. A provider's HTTP client is
 * wrapped so it physically cannot reach a host outside that boundary: the
 * enclave may only talk to loopback, on-prem and the inspector only to private
 * addresses. Mis-pointing the enclave at a hosted API fails closed.
 */

export type Binding = EnvKey | "inspector";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface CompleteOptions {
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Forces non-streaming JSON-shaped output. Used by the classifier. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface Provider {
  readonly id: string;
  readonly model: string;
  /** Where requests go — a URL, or "in-process" for the mock. */
  readonly endpoint: string;
  stream(opts: CompleteOptions): AsyncIterable<string>;
  complete(opts: CompleteOptions): Promise<string>;
}

type Fetcher = typeof fetch;

/* ------------------------------------------------------------ boundaries */

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i;
const PRIVATE = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;

export interface EgressCheck {
  ok: boolean;
  reason: string;
}

/** What each binding may reach. The enclave may not leave the host at all. */
export function egressAllowed(binding: Binding, endpoint: string): EgressCheck {
  if (endpoint === "in-process") return { ok: true, reason: "in-process provider, no network" };
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch {
    return { ok: false, reason: `invalid endpoint "${endpoint}"` };
  }
  const loop = LOOPBACK.test(host);
  const priv = PRIVATE.test(host);

  if (binding === "airgap") {
    return loop
      ? { ok: true, reason: "loopback only — no outbound route" }
      : { ok: false, reason: `${host} is off-host; the enclave has no outbound route` };
  }
  if (binding === "onprem" || binding === "inspector") {
    return loop || priv
      ? { ok: true, reason: "sovereign network only" }
      : { ok: false, reason: `${host} is outside the sovereign network` };
  }
  return { ok: true, reason: "external egress permitted" };
}

export class EgressBlockedError extends Error {
  constructor(readonly binding: Binding, reason: string) {
    super(`Egress blocked for ${binding}: ${reason}`);
    this.name = "EgressBlockedError";
  }
}

/** A fetch that refuses to open a connection outside the binding's boundary. */
function boundaryFetch(binding: Binding): Fetcher {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const check = egressAllowed(binding, new URL(url).origin);
    if (!check.ok) return Promise.reject(new EgressBlockedError(binding, check.reason));
    return fetch(input, init);
  };
}

/* ------------------------------------------------------------------ ollama */

class OllamaProvider implements Provider {
  readonly id = "ollama";
  constructor(
    readonly model: string,
    readonly endpoint: string,
    private readonly fetcher: Fetcher,
  ) {}

  private body(opts: CompleteOptions, stream: boolean) {
    const messages: ChatMessage[] = opts.system
      ? [{ role: "system", content: opts.system }, ...opts.messages]
      : opts.messages;
    return JSON.stringify({
      model: this.model,
      messages,
      stream,
      // Reasoning models spend their whole budget "thinking" and return an empty
      // content field. Structured verdicts want the answer, not the deliberation.
      ...(opts.json ? { format: "json", think: false } : {}),
      options: {
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
      },
    });
  }

  async *stream(opts: CompleteOptions): AsyncIterable<string> {
    const res = await this.fetcher(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: this.body(opts, true),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`ollama ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Ollama emits newline-delimited JSON objects.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const chunk = obj.message?.content;
          if (chunk) yield chunk;
        } catch {
          /* partial line — the next read completes it */
        }
      }
    }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const res = await this.fetcher(`${this.endpoint}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: this.body(opts, false),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text().catch(() => "")}`);
    const obj = (await res.json()) as { message?: { content?: string } };
    return obj.message?.content ?? "";
  }
}

/* --------------------------------------------------------------- anthropic */

class AnthropicProvider implements Provider {
  readonly id = "anthropic";
  constructor(
    readonly model: string,
    private readonly apiKey: string,
    readonly endpoint: string,
    private readonly fetcher: Fetcher,
  ) {}

  private body(opts: CompleteOptions, stream: boolean) {
    return JSON.stringify({
      model: this.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.7,
      ...(opts.system ? { system: opts.system } : {}),
      messages: opts.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      stream,
    });
  }

  private headers() {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  async *stream(opts: CompleteOptions): AsyncIterable<string> {
    const res = await this.fetcher(`${this.endpoint}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(opts, true),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => "")}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (evt.type === "content_block_delta" && evt.delta?.text) yield evt.delta.text;
        } catch {
          /* ignore partial frames */
        }
      }
    }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const res = await this.fetcher(`${this.endpoint}/v1/messages`, {
      method: "POST",
      headers: this.headers(),
      body: this.body(opts, false),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => "")}`);
    const obj = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return (obj.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
}

/* -------------------------------------------------------------------- mock */

class MockProvider implements Provider {
  readonly id = "mock";
  readonly model = "mizan-mock";
  readonly endpoint = "in-process";

  async *stream(opts: CompleteOptions): AsyncIterable<string> {
    const text = await this.complete(opts);
    for (const word of text.split(/(\s+)/)) {
      await new Promise((r) => setTimeout(r, 18));
      yield word;
    }
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const last = [...opts.messages].reverse().find((m) => m.role === "user");
    if (opts.json) return JSON.stringify({ level: "OFFICIAL", confidence: 0.5, rationale: "Mock inspector." });
    return `[simulated response] Received a ${last?.content.length ?? 0}-character request. ` +
      `This environment is running the mock provider, so no model was invoked.`;
  }
}

/* ----------------------------------------------------------------- factory */

const cache = new Map<Binding, Provider>();

/** Per-binding override, falling back to the global setting. */
function setting(key: string, binding: Binding): string | undefined {
  return process.env[`${key}_${binding.toUpperCase()}`] ?? process.env[key];
}

export function getProvider(binding: Binding = "inspector"): Provider {
  const hit = cache.get(binding);
  if (hit) return hit;

  const kind = (setting("MIZAN_PROVIDER", binding) ?? "ollama").toLowerCase();
  const fetcher = boundaryFetch(binding);
  let provider: Provider;

  if (kind === "anthropic") {
    const key = setting("ANTHROPIC_API_KEY", binding);
    if (!key) throw new Error(`${binding} is bound to anthropic but ANTHROPIC_API_KEY is unset`);
    provider = new AnthropicProvider(
      setting("ANTHROPIC_MODEL", binding) ?? "claude-sonnet-5",
      key,
      setting("ANTHROPIC_BASE_URL", binding) ?? "https://api.anthropic.com",
      fetcher,
    );
  } else if (kind === "mock") {
    provider = new MockProvider();
  } else {
    provider = new OllamaProvider(
      setting("OLLAMA_MODEL", binding) ?? "gemma4:e2b",
      setting("OLLAMA_HOST", binding) ?? "http://127.0.0.1:11434",
      fetcher,
    );
  }
  cache.set(binding, provider);
  return provider;
}

export interface BindingInfo {
  id: string;
  model: string;
  endpoint: string;
  egress: EgressCheck;
}

/** Describe a binding without calling it — for the router and the console. */
export function bindingInfo(binding: Binding): BindingInfo {
  try {
    const p = getProvider(binding);
    return { id: p.id, model: p.model, endpoint: p.endpoint, egress: egressAllowed(binding, p.endpoint) };
  } catch (err) {
    return {
      id: "unconfigured", model: "—", endpoint: "—",
      egress: { ok: false, reason: err instanceof Error ? err.message : String(err) },
    };
  }
}
