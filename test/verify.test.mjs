// node test/verify.test.mjs
import assert from "node:assert/strict";
import { checkText, checkFacts, summarize } from "../public/js/verify.js";

const input = "Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded.";

// Verified claims pass through untouched.
let r = checkText("You charged $49.99 on October 3rd for member 448210.", input);
assert.deepEqual(r.claims.map((c) => c.status), ["verified", "verified", "verified"]);
assert.equal(r.text, "You charged $49.99 on October 3rd for member 448210.");

// Invented contact details are caught and replaced.
r = checkText("Call 1-800-555-0199 or email help@lumenfit.com or visit lumenfit.com/cancel.", input);
assert.deepEqual(r.claims.map((c) => c.status), ["caught", "caught", "caught"]);
assert.ok(!r.text.includes("555"));
assert.ok(r.text.includes("[COMPANY PHONE"));

// Invented amounts, dates, deadlines, and laws are flagged.
r = checkText("Refund $59.99 by November 12 within 5 business days, as required under the Consumer Protection Act.", input);
assert.deepEqual(r.claims.map((c) => [c.kind, c.status]), [
  ["money", "unverified"],
  ["date", "unverified"],
  ["duration", "unverified"],
  ["law", "unverified"],
]);

// Money written differently still matches.
r = checkText("the 49.99 dollars charge", input);
assert.equal(r.claims[0].status, "verified");

// Facts that don't quote the user are dropped, as are facts that add numbers.
const { kept, dropped } = checkFacts(
  [
    { fact: "Charged $49.99 on Oct 3", quote: "charged me $49.99 on Oct 3" },
    { fact: "Cancelled on Sept 28", quote: "I cancelled on Sept 28" },
    { fact: "Has been a member for 3 years", quote: "member for 3 years" },
    { fact: "Charged $49.99 plus a $10 fee", quote: "charged me $49.99" },
  ],
  input
);
assert.equal(kept.length, 2);
assert.equal(dropped.length, 2);

// A paraphrased "quote" is fine when the fact's numbers check out and its words are the user's.
const pharm = "Sunrise Pharmacy charged me $120 for a prescription that's supposed to be $10 with my insurance.";
const p = checkFacts(
  [
    { fact: "They were charged $120 for a prescription.", quote: "They were charged $120 for a prescription" },
    { fact: "Their insurance is involved.", quote: "[UNKNOWN]" },
    { fact: "They were charged $140 for a prescription.", quote: "They were charged $140" },
  ],
  pharm
);
assert.deepEqual(p.kept.map((f) => f.fact), ["They were charged $120 for a prescription."]);

const s = summarize([checkText("Call 1-800-555-0199 about [ORDER NUMBER] and $49.99", input)]);
assert.deepEqual(s, { verified: 1, caught: 1, unverified: 0, placeholders: 2 });

console.log("verify: all checks passed");
