// Please Hold — the prompts and schemas that turn one sentence into an errand kit.
// Two model passes: (1) pull out only what the user actually said, (2) write the kit
// from those facts alone. Everything that must be correct (leverage, IVR tips, the
// follow-up email, the reminder) is written by hand in this repo, not by the model.

export const ERRAND_TYPES = ["cancel", "refund", "billing_dispute", "return", "repair_or_fix", "complaint", "other"];

export const FACTS_SCHEMA = {
  type: "object",
  properties: {
    company: { type: "string" },
    errand_type: { type: "string", enum: ERRAND_TYPES },
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          fact: { type: "string" },
          quote: { type: "string" },
        },
        required: ["fact", "quote"],
      },
    },
    goal: { type: "string" },
    fallback_goal: { type: "string" },
    missing: { type: "array", items: { type: "string" } },
  },
  required: ["company", "errand_type", "facts", "goal", "fallback_goal", "missing"],
};

export const KIT_SCHEMA = {
  type: "object",
  properties: {
    email_subject: { type: "string" },
    email_body: { type: "string" },
    chat_message: { type: "string" },
    phone_opener: { type: "string" },
    phone_ask: { type: "string" },
    if_they_refuse: { type: "array", items: { type: "string" } },
    phone_close: { type: "string" },
  },
  required: ["email_subject", "email_body", "chat_message", "phone_opener", "phone_ask", "if_they_refuse", "phone_close"],
};

const RULES = `Hard rules:
- Use ONLY facts the user wrote. Never invent phone numbers, websites, email addresses, order or account numbers, dates, amounts, names, laws, regulations, or company policies.
- If something useful is unknown, write a placeholder in square brackets, e.g. [ACCOUNT EMAIL] or [ORDER NUMBER].
- Do not mention any law, act, regulation, or legal right. The app adds verified ones separately.
- Plain, calm, firm, polite. No threats. No exclamation marks.`;

export function factsMessages(errand) {
  return [
    {
      role: "system",
      content: `You read one sentence about a customer-service errand someone has been avoiding and extract what they said.
${RULES}
Each "fact" is one short, complete sentence in the third person (e.g. "They were charged $49.99 on Oct 3.").
For every fact, "quote" must be copied word-for-word from the user's text (the span that supports it).
"goal" is what they want, in one short sentence. "fallback_goal" is a reasonable second-best outcome to ask for if the first is refused (e.g. a partial refund or account credit), phrased as a request, not a fact.
"missing" lists up to 3 details they should have ready (e.g. account email, order number, date of charge) that they did NOT give.
Reply with JSON only.`,
    },
    { role: "user", content: errand },
  ];
}

export function kitMessages(errand, facts) {
  const factLines = facts.facts.map((f) => `- ${f.fact}`).join("\n") || "- (no specific facts given)";
  return [
    {
      role: "system",
      content: `You write a ready-to-use kit for a customer-service errand, using only the facts provided.
${RULES}
Fields:
- email_subject: short and specific.
- email_body: 90-160 words. Greeting, what happened (facts only), the exact request, ask for written confirmation and a reference number, sign off with [YOUR NAME]. Use placeholders for unknown details. Separate paragraphs with a blank line (\\n\\n).
- chat_message: the same request in 2-3 sentences for a support chat box.
- phone_opener: the first two sentences to say when a person answers.
- phone_ask: one sentence that states the exact outcome wanted.
- if_they_refuse: 3 short, polite lines to say if the agent says no (ask for a supervisor or the cancellations/retention team, restate the request, ask for the ${facts.fallback_goal ? "fallback: " + facts.fallback_goal : "best alternative they can offer"}).
- phone_close: one or two sentences that ask for a reference number and the agent's name, and confirm what was agreed.
Reply with JSON only.`,
    },
    {
      role: "user",
      content: `The user's own words: "${errand}"

Company: ${facts.company || "[COMPANY]"}
Errand type: ${facts.errand_type}
Verified facts:
${factLines}
Goal: ${facts.goal}`,
    },
  ];
}

// --- Hand-written parts (not model output) ---------------------------------

export const GET_A_HUMAN = [
  "Call from a quiet place with your account email, the charge or order details, and something to write on.",
  "Phone menus often respond to plain words. Saying \"representative\" or \"cancel service\" usually routes you somewhere useful. Cancellations often go to a retention team that can also issue credits.",
  "If a menu keeps looping, saying \"agent\" or pressing 0 sometimes works. It depends on the company.",
  "Write down the time, the agent's first name, and the reference number before you hang up. Please Hold has a call log for exactly this.",
  "If they promise something, ask them to send it in writing (email or chat transcript).",
];

// General consumer-rights pointers, shown only when the errand type and region match.
// Each one links to an official source. Not legal advice.
export const LEVERAGE = [
  {
    id: "us-fcba",
    regions: ["US"],
    types: ["refund", "billing_dispute", "cancel"],
    title: "Credit card billing errors: dispute in writing within 60 days",
    body: "If you paid by credit card and the charge is a billing error (for example, charged after you cancelled), US law lets you dispute it with your card issuer. A phone call alone doesn't count: send a letter so it reaches the issuer within 60 days after the first bill with the error was sent to you.",
    source: "FTC — Using Credit Cards and Disputing Charges",
    url: "https://consumer.ftc.gov/articles/using-credit-cards-and-disputing-charges",
  },
  {
    id: "eu-withdrawal",
    regions: ["EU"],
    types: ["cancel", "return", "refund"],
    title: "Online and distance purchases: 14 days to change your mind",
    body: "In the EU you generally have 14 days to withdraw from a purchase made online, by phone, or by mail, without giving a reason. Some exceptions apply (for example, personalised goods or digital content you've started using).",
    source: "Your Europe — Cancelling a purchase",
    url: "https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm",
  },
  {
    id: "uk-ccr",
    regions: ["UK"],
    types: ["cancel", "return", "refund"],
    title: "Bought online: 14 days to cancel",
    body: "In the UK most things bought online come with an automatic 14-day cooling-off period that starts the day after you receive your order. Nothing has to be wrong with the item. Bespoke or made-to-measure items are excluded.",
    source: "Citizens Advice — safe and savvy shopping tips",
    url: "https://www.citizensadvice.org.uk/about-us/media-centre/press-releases/citizens-advice-top-tips-for-safe-and-savvy-consumers-on-black-friday/",
  },
  {
    id: "uk-cra-faulty",
    regions: ["UK"],
    types: ["return", "refund", "repair_or_fix", "complaint"],
    title: "Faulty goods: 30 days to reject for a full refund",
    body: "You have 30 days to return something faulty with a guaranteed refund. After that, the retailer can choose to repair or replace it instead. This applies to goods bought online or in a shop.",
    source: "Citizens Advice — safe and savvy shopping tips",
    url: "https://www.citizensadvice.org.uk/about-us/media-centre/press-releases/citizens-advice-top-tips-for-safe-and-savvy-consumers-on-black-friday/",
  },
];

export function leverageFor(type, region) {
  return LEVERAGE.filter((l) => l.regions.includes(region) && l.types.includes(type));
}

// Follow-up email written from the user's own call log. No model involved.
export function followUpEmail({ company, goal, rep, ref, when, agreed }) {
  const c = company || "[COMPANY]";
  const date = when ? new Date(when).toLocaleString([], { dateStyle: "long", timeStyle: "short" }) : "[DATE AND TIME]";
  return {
    subject: `Confirming our call${ref ? " — reference " + ref : ""}`,
    body: `Hello ${c} team,

I'm writing to confirm my phone call on ${date}${rep ? " with " + rep : ""}${ref ? " (reference " + ref + ")" : ""}.

What I asked for: ${goal || "[MY REQUEST]"}
What was agreed: ${agreed || "[WHAT THEY AGREED TO]"}

Please reply to confirm this in writing. If anything above is different from your records, let me know.

Thank you,
[YOUR NAME]`,
  };
}

// A calendar reminder (.ics) to check that what was promised actually happened.
export function reminderIcs({ title, details, daysFromNow = 7 }) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const ymd = (x) => x.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(d);
  end.setDate(end.getDate() + 1);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Please Hold//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@please-hold`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(d)}`,
    `DTEND;VALUE=DATE:${ymd(end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(details)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
