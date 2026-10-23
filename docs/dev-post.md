*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)*

## What I Built

Everybody has one. The charge you meant to dispute. The subscription that renewed after you cancelled. The bill that went up $30 with no warning. You know exactly what you want. You just don't want to sit through the phone tree, explain it three times, and remember to ask for a reference number.

>> TODO (Penta): 2–3 sentences about YOUR errand. Which one had been sitting on your list, and for how long? This is the hook judges will remember. Keep it true.

Before I built anything this week, I had an agent go read what people actually complain about online. The loudest category wasn't sleep or inboxes. It was dealing with companies. A February 2026 Groundwork Collaborative study, [reported by Fortune](https://www.fortune.com/2026/02/19/americans-paying-over-165-billion-annually-vibes-based-taxes-annoyance-economy), puts the "annoyance economy" at about $165 billion a year and finds Americans spend 60% more time on customer-service calls than 20 years ago. On Trustpilot, Calm sits at 1.4 out of 5, and the reviews are mostly billing traps: "They charged me $85 for a free trial and then refused a refund."

Then I checked the challenge tag. Around 545 Week 3 posts, a lot of file sorters, a lot of inbox digests, four bedtime companions. Nobody had taken the customer's side of the phone call.

**Please Hold** does. You type one sentence:

> Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded.

and get back the whole errand, ready to go:

- **A phone script.** The first thing to say, the exact ask, three polite lines for when they say no, and how to close the call (name, reference number, what was agreed).
- **An email and a chat message**, ready to send.
- **Your leverage.** Short, sourced consumer-rights pointers for the US, UK and EU that match your errand. I wrote these by hand. The model never writes them.
- **Hold mode.** A full-screen card with your script, a hold timer, and calm hold music generated on your device. Your hold music, not theirs.
- **After the call.** Type the agent's name and reference number, and it writes the confirmation email and a calendar reminder to check they actually did it. No model in this step, so nothing gets made up.

Gemma runs **in your browser**. Your account numbers, your address, the money you're owed: none of it leaves your machine.

## Demo

**Live:** https://please-hold.dankpenta.workers.dev (desktop Chrome or Edge for on-device Gemma; any browser for the opt-in cloud mode)

![Writing a kit](https://please-hold.dankpenta.workers.dev/shots/02-kit.png)

![Hold mode](https://please-hold.dankpenta.workers.dev/shots/05-hold.png)

![After the call: confirmation email from your own notes](https://please-hold.dankpenta.workers.dev/shots/06-after.png)

>> TODO (Penta): optional 30-second screen recording of one real run. Even a GIF beats screenshots here.

## Code

{% github 5thlegend/please-hold %}

MIT licensed. Plain HTML, CSS and ES modules. No build step. One small Worker for the opt-in cloud route.

## How I Built It

### The model writes words, never facts

Small models are helpful in the worst way. Ask one for a cancellation email and it will add a support phone number, a "within 5 business days" promise, or a consumer protection act. None of that came from you, and some of it is invented. In a customer-service call that's not a style problem. Read out a made-up policy to an agent and you've lost the call.

So Please Hold never trusts the model's output. It runs two passes and then checks the receipts:

1. **Pass 1, extract.** Gemma pulls out the company, the errand type, and the facts, and every fact has to quote your sentence word for word. Facts whose quote doesn't match what you typed, or that sneak in a number you never gave, are dropped before anything gets written.
2. **Pass 2, write.** Gemma writes the email, chat message and phone script from the surviving facts only. Unknowns become `[ORDER NUMBER]`-style blanks.
3. **The receipts check.** Plain JavaScript, no model, finds every checkable claim in the output (phone numbers, URLs, emails, amounts, dates, durations, percentages, account numbers, legal-sounding phrases) and compares each one against your own words.

```js
// public/js/verify.js (trimmed)
for (const c of findClaims(output)) {
  const status = isVerified(c.kind, c.text, idx)
    ? "verified"                       // it's in what you typed
    : c.catchable ? "caught"           // phone/URL/email you never gave: replaced
    : "unverified";                    // number, date, deadline, law: highlighted
  segments.push({ text: status === "caught" ? PLACEHOLDER[c.kind] : c.text, status });
}
```

On screen, anything from your words gets a dotted underline. An invented phone number is removed and replaced with *[COMPANY PHONE — copy it from your bill]*. Anything else you didn't say is highlighted yellow so you check it before you read it to a stranger.

Both passes use **structured output**: a JSON schema is passed to the model so it can only produce the fields the app expects. WebLLM enforces it with grammar-constrained decoding, Ollama with `format`, and Workers AI with `response_format`.

### Where Gemma runs

| Option | Model | Where your text goes |
|---|---|---|
| This device (default) | Gemma 4 E2B via [WebLLM](https://github.com/mlc-ai/web-llm) on WebGPU, 2.8 GB once | Nowhere |
| This device, light | Gemma 3 1B, 0.6 GB once | Nowhere |
| Your Ollama | whatever Gemma you already run | Nowhere |
| Cloudflare (opt-in) | Gemma 4 26B A4B on Workers AI | Cloudflare. The app doesn't store or log it |

The cloud option exists for phones and browsers without WebGPU, and it is labeled as sending your text. Same open model family either way. You pick where it runs.

### The bug that ate an afternoon

The on-device path worked everywhere except the live site. WebLLM said `Failed to execute 'open' on 'CacheStorage'`, so I added an IndexedDB fallback. Then it said `Failed to fetch`. Chrome said CORS. curl said everything was fine.

I replayed Chrome's exact request with curl and changed one header at a time. Hugging Face returns **404 with no CORS headers to any request whose `Referer` is a `*.workers.dev` page**. No Referer: 302 and the download proceeds. The fix was one meta tag and one header:

```html
<meta name="referrer" content="no-referrer">
```

```
# public/_headers
/*
  Referrer-Policy: no-referrer
```

If you deploy in-browser models to `workers.dev` and the weights live on Hugging Face, you'll hit this too.

### The parts I wrote by hand

Anything that has to be right is not generated: the consumer-rights pointers (each checked against an official page: [FTC](https://consumer.ftc.gov/articles/using-credit-cards-and-disputing-charges), [Your Europe](https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm), [Citizens Advice](https://www.citizensadvice.org.uk/about-us/media-centre/press-releases/citizens-advice-top-tips-for-safe-and-savvy-consumers-on-black-friday/)), the "getting to a human" tips, the follow-up email built from your call log, and the `.ics` reminder. The hold music is four slow major-seventh chords and a soft bell, generated live with the Web Audio API. No audio files.

## Does it actually behave?

I wrote 24 realistic errands (refunds, cancellations, a lost suitcase, a pharmacy overcharge, a security deposit, a free trial about to convert) and ran each through the full pipeline, then counted what the receipts check found.

| Backend | Errands | Claims that matched your words | Invented contact details caught | Flagged for you to check | Avg time per kit |
|---|---|---|---|---|---|
| Gemma 4 26B (Workers AI) | 24/24 | 174 | 0 | 4 | 17 s |
| Gemma 4 E2B (in browser, RTX 4050 laptop) | {{DEVICE_OK}} | {{DEVICE_V}} | {{DEVICE_C}} | {{DEVICE_U}} | {{DEVICE_S}} s |

The four cloud flags were all the same thing: the pharmacy errand said "$120 for a prescription that's supposed to be $10," and Gemma helpfully asked for a "$110 refund." The math is right, but you never said $110, so it gets highlighted for you to confirm. That's the point of the check: it doesn't decide what's true, it shows you what didn't come from you.

>> TODO (after the device run): one sentence on what the small on-device model got wrong that the check caught. Use a real example from test/results-device-4.json.

## The Lazy Payoff

Across those 24 errands, you type about 25 words and Please Hold writes about 216: an email, a chat message, and a four-part phone script with your facts already in it. Every kit took under half a minute.

>> TODO (Penta): run one real errand of yours and fill this in honestly:
>> - How long you'd been putting it off:
>> - Time from typing to kit:
>> - Time on hold (the app tracks it):
>> - Outcome, and money recovered if any:

The app keeps a **lazy ledger** in your browser: errands finished, time spent on hold, words you didn't have to write, money recovered.

## Why Does Open Innovation Matter?

- **The data is the sensitive part.** A customer-service errand is account numbers, addresses, and money owed. With open weights running in the browser, that text never leaves the device. Not "we don't store it." It never gets sent.
- **No subscription, for an app about subscription traps.** The thing people hate most about the incumbents is getting charged. A model that runs on your own GPU costs nothing per errand, forever.
- **I can constrain it because I can run it.** Open weights plus open runtimes let me force a JSON schema with grammar-constrained decoding, run the same model family on device, on Ollama, or in the cloud, and check its output with my own code. The honesty system is mine, not a vendor setting.
- **You choose where it runs.** Same Gemma family on a laptop GPU, on your own Ollama box, or on Cloudflare when you're on a phone. Open weights make that a dropdown, not a migration.
- **Where open beat closed.** A frontier API would write smoother emails. It would also send your account details to a third party to cancel a subscription with a different third party. For this job, small, local, and checked beats big and trusted.

## What it doesn't do

It doesn't make the call for you, and it doesn't give legal advice. The rights pointers are general information with links to the official source. The small on-device model writes plainer prose than the cloud one. That's why the checks exist.

## My Agent Session

I built this with an AI agent in one sitting, from "go research what people actually complain about" through the deploy. The session shows the research that killed my first idea (four other people had already built the bedtime companion), the design rule that the model writes words and never facts, and the Referer bug.

{% agent_session {{SESSION_ID}} %}

## Prize Categories

- **Best Use of Gemma:** Gemma is the whole engine. Gemma 4 E2B in the browser by default, Gemma 3 1B as the light option, Gemma via Ollama, and Gemma 4 26B on Workers AI as an opt-in fallback, all held to the same receipts check.
