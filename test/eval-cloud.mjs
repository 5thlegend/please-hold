// node test/eval-cloud.mjs [baseUrl]
// Runs every errand in errands.json through the full two-pass flow on the cloud backend
// and counts what the receipts check found. Writes test/results-cloud.json.
import { readFile, writeFile } from "node:fs/promises";
import { factsMessages, kitMessages, FACTS_SCHEMA, KIT_SCHEMA } from "../public/js/kit.js";
import { checkFacts, checkText, summarize } from "../public/js/verify.js";

const base = process.argv[2] || "https://please-hold.dankpenta.workers.dev";
const errands = JSON.parse(await readFile(new URL("./errands.json", import.meta.url), "utf8"));

async function call(messages, schema, maxTokens) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(base + "/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, schema, maxTokens }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return JSON.parse(j.text);
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("cloud call failed");
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
const totals = { errands: results.length, ok: ok.length, verified: sum("verified"), caught: sum("caught"), unverified: sum("unverified"), dropped: sum("dropped"), placeholders: sum("placeholders"), avgSecs: +(sum("secs") / ok.length).toFixed(1), avgWords: Math.round(sum("words") / ok.length) };
console.log(totals);
await writeFile(new URL("./results-cloud.json", import.meta.url), JSON.stringify({ totals, results }, null, 1));
