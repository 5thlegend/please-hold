*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)*

## What I Built

Everybody has one. The charge you meant to dispute. The subscription that renewed after you cancelled. The bill that went up $30 with no warning. You know exactly what you want. You just don't want to sit through the phone tree, explain it three times, and remember to ask for a reference number.

>> TODO (Penta): 2–3 sentences about YOUR errand. Which one had been sitting on your list, and for how long? This is the line judges will remember. Keep it true.

Before I built anything this week, I had an agent go read what people actually complain about online. The loudest category wasn't sleep or inboxes. It was dealing with companies. A February 2026 Groundwork Collaborative study, [reported by Fortune](https://www.fortune.com/2026/02/19/americans-paying-over-165-billion-annually-vibes-based-taxes-annoyance-economy), puts the "annoyance economy" at about $165 billion a year and finds Americans spend 60% more time on customer-service calls than 20 years ago. On [Trustpilot](https://www.trustpilot.com/review/www.calm.com), Calm sits at 1.4 out of 5, and the reviews are mostly billing traps: "They charged me $85 for a free trial and then refused a refund."

Then I checked this challenge's tag. Around 545 Week 3 posts: a lot of file sorters, a lot of inbox digests, and four bedtime companions, which was the idea I'd planned to build. Nobody had taken the customer's side of the phone call.

**Please Hold** does. You type one sentence:

> Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded.

and get back the whole errand:

- **A phone script** in your voice: the first thing to say, the exact ask, three polite lines for when they say no, and how to close (agent's name, reference number, what was agreed).
- **An email and a chat message**, ready to send.
- **Your leverage.** Short, sourced consumer-rights pointers for the US, UK and EU that match the errand. I wrote these by hand. The model never writes them.
- **Hold mode.** A full-screen card with your script, a hold timer, and calm hold music generated on your device. Your hold music, not theirs.
- **After the call.** Type the agent's name and reference number, and it writes the confirmation email and a calendar reminder to check they actually did it. No model in this step, so nothing gets made up.

Gemma runs **on your own computer** through Ollama. Your account numbers, your address, the money you're owed: none of it leaves your machine. If you just want to try it on a phone, there's an opt-in cloud mode, clearly labeled.

## Demo

**Live:** https://please-hold.dankpenta.workers.dev

To keep everything local, install [Ollama](https://ollama.com), run `ollama pull gemma3:4b`, and start it with the site allowed:

```bash
OLLAMA_ORIGINS=https://please-hold.dankpenta.workers.dev ollama serve
```

Or pick **Gemma 4 26B on Cloudflare** to try it on any device right now.

![A finished kit: receipts summary, the ask, and the phone script](https://please-hold.dankpenta.workers.dev/shots/02-kit.png)

![Hold mode: timer, your script, your own hold music](https://please-hold.dankpenta.workers.dev/shots/05-hold.png)

![After the call: a confirmation email written from your own notes](https://please-hold.dankpenta.workers.dev/shots/06-after.png)

*Screenshots from a run on my laptop with `gemma3:4b` in Ollama. The ledger numbers are from that test run.*

>> TODO (Penta): optional 30-second screen recording of one real run.

## Code

{% github 5thlegend/please-hold %}

MIT licensed. Plain HTML, CSS and ES modules, no build step. One small Cloudflare Worker for the opt-in cloud route.

## How I Built It

### The model writes words, never facts

Small models are helpful in the worst way. Ask one for a cancellation email and it may add a support phone number, a "within 5 business days" promise, or a consumer protection act. None of that came from you, and some of it is invented. On a customer-service call that's not a style problem. Read a made-up policy to an agent and you've lost the call.

So Please Hold never trusts the model's output. It runs two passes, then checks the receipts:

1. **Pass 1, extract.** Gemma pulls out the company, the errand type, and the facts, each with a quote from your sentence. A fact survives only if its quote really is your words, or if every number in it matches what you typed and most of its words are yours. Anything else is dropped before a word gets written.
2. **Pass 2, write.** Gemma writes the email, chat message and phone script from the surviving facts only, in your voice. Unknowns become `[ORDER NUMBER]`-style blanks.
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

Both passes use **structured output**: the JSON schema goes to the model, so it can only produce the fields the app expects (Ollama's `format`, Workers AI's `response_format`).

### The parts I wrote by hand

Anything that has to be right isn't generated. That covers the consumer-rights pointers, each checked against an official page ([FTC](https://consumer.ftc.gov/articles/using-credit-cards-and-disputing-charges), [Your Europe](https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm), [Citizens Advice](https://www.citizensadvice.org.uk/about-us/media-centre/press-releases/citizens-advice-top-tips-for-safe-and-savvy-consumers-on-black-friday/)). It also covers the "getting to a human" tips, the follow-up email built from your call log, and the `.ics` reminder. The hold music is four slow major-seventh chords and a soft bell, generated live with the Web Audio API. No audio files.

### Where Gemma runs

| Option | Model | Where your text goes |
|---|---|---|
| Your computer (default when found) | any Gemma in Ollama, e.g. `gemma3:4b` | Nowhere |
| Cloudflare (opt-in) | Gemma 4 26B A4B on Workers AI | Cloudflare. The app doesn't store or log it |

## What broke: I tried to put Gemma in the browser

My plan was for Gemma to run inside the tab with nothing to install. I spent most of an afternoon on it, and it didn't ship. Here's what happened on my laptop (RTX 4050 6 GB, 16 GB RAM, Chrome):

- **Gemma 4 E2B on WebLLM 0.2.86**, the first WebLLM release with Gemma 4, lost the WebGPU device on the first token. So did every other model on 0.2.86. 0.2.85 is stable but has no Gemma 4.
- **Gemma 4 E2B on Transformers.js 4.3.0** downloaded all ~3.3 GB of weights, then the tab crashed loading them.
- **Gemma 3 1B on WebLLM 0.2.85** runs, but it's too small for this job. Under a JSON grammar it printed whitespace until it hit the token limit. Without one, it echoed my prompt back, or worse: it answered with a refund for "$10.99 on Oct 28." The user had typed $49.99 and Oct 3.

That last one is the whole argument for the receipts check, made by the model itself. It's still in the app behind `?lab=1` if you want to watch it struggle.

Two bugs from that detour that you might hit too:

- **Hugging Face rejects `*.workers.dev` referrers.** WebLLM said `Failed to execute 'open' on 'CacheStorage'`, then `Failed to fetch`. Chrome said CORS, and curl said everything was fine. Replaying Chrome's exact request one header at a time showed it: Hugging Face returns 404 with no CORS headers to any model download whose `Referer` is a `*.workers.dev` page. The fix is one line, `<meta name="referrer" content="no-referrer">` (plus the matching `Referrer-Policy` header).
- **WebLLM's prebuilt Gemma 3 1B config rejects itself.** It sets both a 4096 context and a 512 sliding window, and WebLLM refuses that combination. `chatOpts: { context_window_size: 4096, sliding_window_size: -1 }` gets it to load.

So the local path is Ollama. It's one install, and the model then runs on your own GPU with native CUDA.

## Does it actually behave?

I wrote 24 realistic errands (refunds, cancellations, a lost suitcase, a pharmacy overcharge, a security deposit, a free trial about to convert, an errand where the person doesn't know their account number), ran each through the full pipeline on both backends, and counted what the receipts check found.

| Model | Runs on | Errands | Claims checked | Matched your words | Flagged for you | Invented contact details | Avg time per kit |
|---|---|---|---|---|---|---|---|
| Gemma 4 26B | Cloudflare Workers AI | 24/24 | 169 | 165 | 4 | 0 | 12.8 s |
| Gemma 3 4B | my laptop, via Ollama | 24/24 | 155 | 151 | 4 | 0 | 16.7 s |

All eight flags were Gemma doing arithmetic. "My bill went from $65 to $95" became "the $30 increase," and "$120 for a prescription that's supposed to be $10" became "a $110 refund." The math is right, but you never said $30, so it's highlighted for you to confirm. The check doesn't decide what's true. It shows you what didn't come from you.

Neither model invented a phone number on this set. I'd still never ship without the check, after watching the 1B model invent a whole charge on its first try. The local model also had 6 extracted facts dropped for not matching the user's words, before they could reach the email.

## The Lazy Payoff

Across the 24 errands, you type about 19 words and Please Hold writes about 220: an email, a chat message, and a four-part phone script with your facts already in it. Each kit takes 13–17 seconds on average.

>> TODO (Penta): run one real errand of yours and fill this in honestly:
>> - How long you'd been putting it off:
>> - Time from typing to kit:
>> - Time on hold (the app tracks it):
>> - Outcome, and money recovered if any:

The app keeps a **lazy ledger** in your browser: errands finished, time spent on hold, words you didn't have to write, and money recovered.

## Why Does Open Innovation Matter?

- **The sensitive part is the data.** A customer-service errand is account numbers, addresses, and money owed. With open weights on your own machine, that text is never sent anywhere. It isn't a "we don't store it" promise.
- **No subscription, for an app about subscription traps.** The thing people hate most about the incumbents is getting charged. A model on your own GPU costs nothing per errand, forever.
- **I can hold it to account because I can run it.** Open weights plus open runtimes let me force a JSON schema, run the same model family locally or in the cloud, and check every output with my own code. The honesty system is mine, not a vendor setting.
- **You choose where it runs.** The same Gemma family runs on a laptop GPU through Ollama, or on Cloudflare when you're on a phone. Open weights make that a radio button, not a migration.
- **Where open beat closed, and where it didn't.** A frontier API would write smoother emails. It would also send your account details to one company so you can argue with another. And open isn't magic: the in-browser route wasn't ready on my hardware this week. Small, local, and checked was the right trade for this job.

## What it doesn't do

It doesn't make the call for you, and it doesn't give legal advice. The rights pointers are general information with links to the official source. The local 4B model writes plainer prose than the cloud one, and that's why the checks exist.

## My Agent Session

I built this with an AI agent in one long sitting, from "go research what people actually complain about" to deploy. The session shows the research that killed my first idea, the rule that the model writes words and never facts, the Referer bug, and the in-browser attempts that didn't make it.

{% agent_session {{SESSION_ID}} %}

## Prize Categories

- **Best Use of Gemma:** Gemma is the whole engine. Gemma 3 4B runs locally through Ollama, and Gemma 4 26B on Workers AI is the opt-in fallback. Both are held to the same receipts check, and both are measured on the same 24 errands above.
