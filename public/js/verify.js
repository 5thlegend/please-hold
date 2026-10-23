// Please Hold — the receipts check.
// A small model will occasionally "helpfully" add a phone number, a date, or a policy
// that the user never gave it. This module never trusts the model: it finds every
// checkable claim in the output and compares it against the user's own words.
//   verified    -> appears in what the user typed
//   caught      -> a phone number, URL, or email the user never gave: replaced with a placeholder
//   unverified  -> a number, date, amount, or legal-sounding phrase not in the input: highlighted
// Runs in the browser and in Node (test/verify.test.mjs).

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const PATTERNS = [
  { kind: "url", re: /\bhttps?:\/\/[^\s)\]]+|\bwww\.[^\s)\]]+|\b[a-z0-9-]+\.(?:com|org|net|gov|io|co|us|uk)\b(?:\/[^\s)\]]*)?/gi, catchable: true },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, catchable: true },
  { kind: "phone", re: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\b1-8\d\d-\d{3}-\d{4}\b/g, catchable: true },
  { kind: "money", re: /[$£€]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|usd|eur|euros|gbp|pounds)\b/gi },
  { kind: "date", re: new RegExp(`\\b(?:${MONTHS.join("|")})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS.join("|")})[a-z]*\\b|\\b\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?\\b`, "gi") },
  { kind: "duration", re: /\b\d+\s?(?:-\s?)?(?:business\s|working\s|calendar\s)?(?:days?|weeks?|months?|hours?)\b/gi },
  { kind: "percent", re: /\b\d+(?:\.\d+)?\s?%/g },
  { kind: "law", re: /\b(?:[A-Z][a-z]+\s){1,5}Act\b|\bSection\s\d+\w*|§\s?\d+|\bU\.S\.C\.?|\b(?:regulation|statute|federal law|state law|by law|legally required|consumer protection law|your (?:legal )?rights? under)\b/g },
  { kind: "number", re: /\b\d{3,}\b/g },
];

const norm = (s) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
const digits = (s) => s.replace(/\D/g, "");
const moneyValue = (s) => {
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function monthDay(s) {
  const t = s.toLowerCase();
  const mi = MONTHS.findIndex((m) => t.includes(m));
  const d = t.match(/\d{1,2}/);
  if (mi >= 0 && d) return `${mi + 1}-${parseInt(d[0], 10)}`;
  const nums = t.match(/^(\d{1,2})[/.-](\d{1,2})/);
  if (nums) return `${parseInt(nums[1], 10)}-${parseInt(nums[2], 10)}`;
  return null;
}

function inputIndex(input) {
  const n = norm(input);
  const moneys = (input.match(PATTERNS.find((p) => p.kind === "money").re) || []).map(moneyValue);
  const bareNums = (input.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => parseFloat(x.replace(/,/g, "")));
  const dates = (input.match(PATTERNS.find((p) => p.kind === "date").re) || []).map(monthDay).filter(Boolean);
  return { n, d: digits(input), moneys, bareNums, dates };
}

function isVerified(kind, text, idx) {
  const t = norm(text);
  if (idx.n.includes(t)) return true;
  switch (kind) {
    case "money": {
      const v = moneyValue(text);
      return v !== null && (idx.moneys.includes(v) || idx.bareNums.includes(v));
    }
    case "date": {
      const md = monthDay(text);
      return md !== null && idx.dates.includes(md);
    }
    case "phone":
    case "number":
      return digits(text).length >= 3 && idx.d.includes(digits(text));
    case "duration":
    case "percent": {
      const v = parseFloat(text);
      return idx.bareNums.includes(v) && idx.n.includes(String(v));
    }
    default:
      return false;
  }
}

const PLACEHOLDER = {
  url: "[COMPANY WEBSITE — copy it from your bill]",
  email: "[SUPPORT EMAIL — copy it from your bill or the company's site]",
  phone: "[COMPANY PHONE — copy it from your bill or card statement]",
};

// Find claims in one string. Overlapping matches keep the earliest, longest one.
function findClaims(text) {
  const hits = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      hits.push({ kind: p.kind, start: m.index, end: m.index + m[0].length, text: m[0], catchable: !!p.catchable });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out = [];
  let lastEnd = -1;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push(h);
      lastEnd = h.end;
    }
  }
  return out;
}

// Check one field. Returns { text, segments, claims } where segments is a list of
// { text, status? } pieces ready for rendering, and text is the cleaned plain text.
export function checkText(output, input) {
  const idx = inputIndex(input);
  const claims = findClaims(output);
  const segments = [];
  const report = [];
  let pos = 0;
  for (const c of claims) {
    if (c.start > pos) segments.push({ text: output.slice(pos, c.start) });
    let status = isVerified(c.kind, c.text, idx) ? "verified" : c.catchable ? "caught" : "unverified";
    // Years and similar bare numbers that happen to be in the input are fine; bare
    // numbers that are not get flagged so the user notices them.
    const shown = status === "caught" ? PLACEHOLDER[c.kind] : c.text;
    segments.push({ text: shown, status, kind: c.kind, original: c.text });
    report.push({ kind: c.kind, text: c.text, status });
    pos = c.end;
  }
  if (pos < output.length) segments.push({ text: output.slice(pos) });
  return { text: segments.map((s) => s.text).join(""), segments, claims: report };
}

// Facts from pass 1 must come from the user. A fact is kept if its quote really is the user's
// words, or (small models often "quote" their own paraphrase) if every number in it checks out
// and most of its content words appear in what the user typed. Anything else is dropped before pass 2.
const FILLER = new Set(["they", "them", "their", "theirs", "were", "was", "the", "and", "that", "this", "have", "has", "had", "with", "for", "user", "customer"]);
export function checkFacts(facts, input) {
  const n = norm(input);
  const words = (s) => norm(s).split(/[^a-z0-9$.£€]+/).filter((w) => w.length > 1);
  const inputWords = new Set(words(input));
  const overlap = (s) => {
    const w = words(s).filter((x) => !FILLER.has(x));
    return w.filter((x) => inputWords.has(x)).length / Math.max(1, w.length);
  };
  const kept = [];
  const dropped = [];
  for (const f of facts || []) {
    const q = norm(f.quote || "").replace(/^["']|["']$/g, "").trim();
    let ok = q.length > 0 && n.includes(q);
    if (!ok && q) ok = overlap(q) >= 0.8;
    if (!ok) ok = overlap(f.fact || "") >= 0.6 && checkText(f.fact || "", input).claims.length > 0;
    // The fact itself must not smuggle in a number the user never typed.
    if (ok) {
      const bad = checkText(f.fact, input).claims.filter((c) => c.status !== "verified");
      if (bad.length) ok = false;
    }
    (ok ? kept : dropped).push(f);
  }
  return { kept, dropped };
}

export function summarize(fieldResults) {
  const all = fieldResults.flatMap((r) => r.claims);
  const count = (s) => all.filter((c) => c.status === s).length;
  const placeholders = fieldResults.reduce((n, r) => n + (r.text.match(/\[[A-Z][^\]]*\]/g) || []).length, 0);
  return { verified: count("verified"), caught: count("caught"), unverified: count("unverified"), placeholders };
}
