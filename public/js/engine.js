// Please Hold — where Gemma runs. Same open model family, your choice of place:
//   device-4  Gemma 4 E2B in this browser tab (WebGPU, ~2.8 GB once, then offline)
//   device-1  Gemma 3 1B in this browser tab (WebGPU, ~0.6 GB, for smaller GPUs)
//   ollama    whatever Gemma you already run with Ollama on this machine
//   cloud     Gemma 4 26B on Cloudflare Workers AI (opt-in: your text leaves the device)

export const BACKENDS = {
  "device-4": { label: "Gemma 4 E2B · this device", model: "gemma-4-E2B-it-q4f16_1-MLC", sizeMB: 2831, local: true },
  "device-1": { label: "Gemma 3 1B · this device", model: "gemma3-1b-it-q4f16_1-MLC", sizeMB: 602, local: true },
  ollama: { label: "Gemma · your Ollama", local: true },
  cloud: { label: "Gemma 4 26B · Cloudflare (sends text)", local: false },
};

const OLLAMA = "http://localhost:11434";

export async function webgpuSupport() {
  if (!("gpu" in navigator)) return { ok: false, f16: false };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { ok: false, f16: false };
    return { ok: true, f16: a.features.has("shader-f16") };
  } catch {
    return { ok: false, f16: false };
  }
}

export async function ollamaModels() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.models || []).map((m) => m.name).filter((n) => /gemma/i.test(n));
  } catch {
    return [];
  }
}

// Prefer the newest Gemma the user already has.
function pickOllama(models) {
  const rank = (n) => (/gemma4/.test(n) ? 3 : /gemma3n/.test(n) ? 2 : /gemma3/.test(n) ? 1 : 0);
  return [...models].sort((a, b) => rank(b) - rank(a))[0];
}

function parseJson(text) {
  const t = String(text).replace(/<\|channel>thought[\s\S]*?<channel\|>/g, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("The model didn't return valid JSON. Try again.");
  }
}

export class Engine {
  constructor() {
    this.kind = null;
    this.webllm = null;
    this.mlc = null;
    this.ollamaModel = null;
    this.modelName = "";
  }

  async load(kind, onProgress = () => {}) {
    this.kind = kind;
    if (kind === "device-4" || kind === "device-1") {
      if (!this.webllm) this.webllm = await import("../vendor/web-llm-0.2.86.js");
      const id = BACKENDS[kind].model;
      if (this.mlc && this.modelName === id) return;
      if (this.mlc) await this.mlc.unload();
      const opts = { initProgressCallback: (p) => onProgress(p.progress ?? 0, p.text || "") };
      try {
        this.mlc = await this.webllm.CreateMLCEngine(id, opts);
      } catch (e) {
        // Some browsers/profiles refuse Cache Storage; IndexedDB works there.
        if (!/cache/i.test(String(e?.message || e))) throw e;
        this.mlc = await this.webllm.CreateMLCEngine(id, { ...opts, appConfig: { ...this.webllm.prebuiltAppConfig, cacheBackend: "indexeddb" } });
      }
      this.modelName = id;
    } else if (kind === "ollama") {
      const models = await ollamaModels();
      if (!models.length)
        throw new Error("No Gemma model found in Ollama. Run `ollama pull gemma3:4b` and start Ollama with OLLAMA_ORIGINS set to this site.");
      this.ollamaModel = pickOllama(models);
      this.modelName = this.ollamaModel;
      onProgress(1, `Using ${this.ollamaModel}`);
    } else {
      this.modelName = "@cf/google/gemma-4-26b-a4b-it";
      onProgress(1, "Using Gemma 4 26B on Cloudflare");
    }
  }

  // One structured call. onToken gets a running token count for the progress UI.
  async json(messages, schema, { maxTokens = 700, onToken = () => {} } = {}) {
    if (this.kind === "device-4" || this.kind === "device-1") {
      // Fold the system prompt into the first user turn; small-model chat templates vary.
      const [sys, ...rest] = messages;
      const msgs = [{ role: "user", content: `${sys.content}\n\n---\n\n${rest[0].content}` }, ...rest.slice(1)];
      const stream = await this.mlc.chat.completions.create({
        messages: msgs,
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: true,
        response_format: { type: "json_object", schema: JSON.stringify(schema) },
      });
      let out = "";
      let n = 0;
      for await (const chunk of stream) {
        out += chunk.choices[0]?.delta?.content || "";
        onToken(++n);
      }
      return parseJson(out);
    }
    if (this.kind === "ollama") {
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: "POST",
        body: JSON.stringify({
          model: this.ollamaModel,
          messages,
          stream: false,
          format: schema,
          options: { temperature: 0.3, num_predict: maxTokens },
          keep_alive: "30m",
        }),
      });
      if (!r.ok) throw new Error(`Ollama error ${r.status}`);
      const j = await r.json();
      onToken(j.eval_count || 0);
      return parseJson(j.message?.content || "");
    }
    const r = await fetch("/api/cloud", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, schema, maxTokens }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Cloud error ${r.status}`);
    onToken(j.tokens || 0);
    return parseJson(j.text);
  }
}
