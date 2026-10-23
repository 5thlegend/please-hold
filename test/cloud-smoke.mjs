// node test/cloud-smoke.mjs [baseUrl] — runs the full two-pass flow against /api/cloud and the receipts check.
import { factsMessages, kitMessages, FACTS_SCHEMA, KIT_SCHEMA } from "../public/js/kit.js";
import { checkFacts, checkText, summarize } from "../public/js/verify.js";
const base = process.argv[2] || "https://please-hold.dankpenta.workers.dev";
const errand = process.argv[3] || "Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded.";
async function call(messages, schema, maxTokens) {
  const r = await fetch(base + "/api/cloud", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, schema, maxTokens }) });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return JSON.parse(j.text);
}
const t0 = Date.now();
const raw = await call(factsMessages(errand), FACTS_SCHEMA, 500);
const { kept, dropped } = checkFacts(raw.facts, errand);
const facts = { ...raw, facts: kept };
const kit = await call(kitMessages(errand, facts), KIT_SCHEMA, 800);
const fields = [kit.email_subject, kit.email_body, kit.chat_message, kit.phone_opener, kit.phone_ask, ...kit.if_they_refuse, kit.phone_close].map((t) => checkText(t || "", errand));
console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(summarize(fields)), `facts kept ${kept.length} dropped ${dropped.length}`);
console.log(JSON.stringify(raw, null, 1).slice(0, 900));
console.log("---\n" + fields.map((f) => f.text).join("\n---\n"));
console.log("FLAGS:", fields.flatMap((f) => f.claims.filter((c) => c.status !== "verified")));
