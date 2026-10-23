// Please Hold — where Gemma runs. Same open model family, your choice of place:
//   device-1  Gemma 3 1B in this browser tab (WebGPU, ~0.6 GB once, then offline)
//   ollama    whatever Gemma you already run with Ollama on this machine
//   cloud     Gemma 4 26B on Cloudflare Workers AI (opt-in: your text leaves the device)
// Gemma 4 E2B needs WebLLM 0.2.86, which crashed the WebGPU device on every generation in
// testing (RTX 4050, Chrome, any model). Pinned to 0.2.85 until that's fixed.

export const BACKENDS = {
  // The prebuilt config sets both a 4096 context and a 512 sliding window, which WebLLM rejects.
  // Our prompts run ~900 tokens, so use the full context and turn the sliding window off.
  "device-1": { label: "Gemma 3 1B · this device", model: "gemma3-1b-it-q4f16_1-MLC", sizeMB: 602, local: true, chatOpts: { context_window_size: 4096, sliding_window_size: -1 } },
  ollama: { label: "Gemma on your computer (Ollama)", local: true },
  cloud: { label: "Gemma 4 26B on Cloudflare", local: false },
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

// A compact example of the JSON a schema expects, for models that don't get a grammar.
function outline(schema) {
  const ex = (sch) =>
    sch.type === "array" ? [ex(sch.items)] : sch.type === "object" ? Object.fromEntries(Object.entries(sch.properties).map(([k, v]) => [k, ex(v)])) : sch.enum ? sch.enum.join("|") : "...";
  return JSON.stringify(ex(schema));
}

// Fill in anything a small model left out so the rest of the app never sees a missing field.
function conform(obj, schema) {
  const out = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    const x = obj?.[k];
    if (v.type === "array") out[k] = Array.isArray(x) ? (v.items.type === "object" ? x.filter((i) => i && typeof i === "object") : x.filter((i) => typeof i === "string")) : [];
    else if (v.enum) out[k] = v.enum.includes(x) ? x : v.enum[v.enum.length - 1];
    else out[k] = typeof x === "string" ? x : "";
  }
  return out;
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
    if (kind === "device-1") {
      if (!this.webllm) this.webllm = await import("../vendor/web-llm-0.2.85.js");
      const id = BACKENDS[kind].model;
      if (this.mlc && this.modelName === id) return;
      if (this.mlc) await this.mlc.unload();
      const opts = { initProgressCallback: (p) => onProgress(p.progress ?? 0, p.text || "") };
      try {
        this.mlc = await this.webllm.CreateMLCEngine(id, opts, BACKENDS[kind].chatOpts);
      } catch (e) {
        // Some browsers/profiles refuse Cache Storage; IndexedDB works there.
        if (!/cache/i.test(String(e?.message || e))) throw e;
        this.mlc = await this.webllm.CreateMLCEngine(id, { ...opts, appConfig: { ...this.webllm.prebuiltAppConfig, cacheBackend: "indexeddb" } }, BACKENDS[kind].chatOpts);
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
  async json(messages, schema, opts = {}) {
    try {
      return await this.#json(messages, schema, opts);
    } catch (e) {
      // A laptop GPU that runs out of memory or resets drops the WebGPU device. Start over
      // cleanly next time and tell the user what to switch to.
      if (/disposed|instance|device|mapAsync|lost/i.test(String(e?.message || e)) && this.mlc) {
        this.mlc = null;
        this.modelName = "";
        throw new Error("Your GPU reset while Gemma was writing (usually not enough free video memory). Try again, or pick Gemma 3 1B or the cloud option.");
      }
      throw e;
    }
  }

  async #json(messages, schema, { maxTokens = 700, onToken = () => {} } = {}) {
    if (this.kind === "device-1") {
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
      this.lastRaw = out;
      return conform(parseJson(out), schema);
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
