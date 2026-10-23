// node test/eval-ollama.mjs [model=gemma3:4b]
// Runs every errand in errands.json through the full two-pass flow on the cloud backend
// on a local Ollama and counts what the receipts check found. Writes test/results-ollama.json.
import { readFile, writeFile } from "node:fs/promises";
import { factsMessages, kitMessages, FACTS_SCHEMA, KIT_SCHEMA } from "../public/js/kit.js";
import { checkFacts, checkText, summarize } from "../public/js/verify.js";

const model = process.argv[2] || "gemma3:4b";
const errands = JSON.parse(await readFile(new URL("./errands.json", import.meta.url), "utf8"));

async function call(messages, schema, maxTokens) {
  const r = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({ model, messages, stream: false, format: schema, options: { temperature: 0.3, num_predict: maxTokens }, keep_alive: "1m" }),
  });
  if (!r.ok) throw new Error("ollama " + r.status);
  const j = await r.json();
  return JSON.parse(j.message.content);
}

const results = [];
for (const errand of errands) {
  const t0 = Date.now();
  try {
    const raw = await call(factsMessages(errand), FACTS_SCHEMA, 500);
    const { kept, dropped } = checkFacts(raw.facts, errand);
    const kit = await call(kitMessages(errand, { ...raw, facts: kept }), KIT_SCHEMA, 800);
    const fields = [raw.goal, raw.fallback_goal, kit.email_subject, kit.email_body, kit.chat_message, kit.phone_opener, kit.phone_ask, ...(kit.if_they_refuse || []), kit.phone_close].map((t) => checkText(t || "", errand));
    const s = summarize(fields);
    const flags = fields.flatMap((f) => f.claims.filter((c) => c.status !== "verified"));
    const words = [kit.email_body, kit.chat_message, kit.phone_opener, kit.phone_ask, ...(kit.if_they_refuse || []), kit.phone_close].join(" ").split(/\s+/).length;
    results.push({ errand, secs: (Date.now() - t0) / 1000, ...s, kept: kept.length, dropped: dropped.length, flags, words });
    console.log(`${s.verified}v ${s.caught}c ${s.unverified}u ${dropped.length}d ${((Date.now() - t0) / 1000).toFixed(1)}s  ${errand.slice(0, 60)}`, flags.length ? JSON.stringify(flags) : "");
  } catch (e) {
    results.push({ errand, error: e.message });
    console.log("ERR", errand.slice(0, 60), e.message);
  }
}
const ok = results.filter((r) => !r.error);
const sum = (k) => ok.reduce((n, r) => n + r[k], 0);
const totals = { model, errands: results.length, ok: ok.length, verified: sum("verified"), caught: sum("caught"), unverified: sum("unverified"), dropped: sum("dropped"), placeholders: sum("placeholders"), avgSecs: +(sum("secs") / ok.length).toFixed(1), avgWords: Math.round(sum("words") / ok.length) };
console.log(totals);
await writeFile(new URL("./results-ollama.json", import.meta.url), JSON.stringify({ totals, results }, null, 1));
