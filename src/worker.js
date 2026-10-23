// Please Hold — Cloudflare Worker.
// Serves the static app. The only server route is the OPT-IN cloud fallback, for people
// whose browser can't run Gemma locally. It runs open-weight Gemma 4 on Workers AI,
// stores nothing, and logs nothing about the request body.

const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const MAX_BODY = 12_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/cloud") {
      if (request.method !== "POST") return json({ error: "POST only" }, 405);
      const raw = await request.text();
      if (raw.length > MAX_BODY) return json({ error: "That errand is too long. Keep it to a few sentences." }, 413);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json({ error: "Bad request" }, 400);
      }
      const { messages, schema, maxTokens } = body;
      if (!Array.isArray(messages) || messages.length > 4) return json({ error: "Bad request" }, 400);
      try {
        const out = await env.AI.run(MODEL, {
          messages,
          max_tokens: Math.min(Number(maxTokens) || 700, 900),
          temperature: 0.3,
          response_format: { type: "json_schema", json_schema: { name: "kit", schema, strict: true } },
          chat_template_kwargs: { enable_thinking: false },
        });
        const text = out?.choices?.[0]?.message?.content ?? out?.response ?? "";
        const tokens = out?.usage?.completion_tokens ?? 0;
        return json({ text: typeof text === "string" ? text : JSON.stringify(text), tokens });
      } catch (e) {
        return json({ error: "Cloud Gemma is busy. Try again, or run it on your device." }, 502);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
