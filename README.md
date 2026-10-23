# Please Hold

**Type the customer-service errand you've been avoiding. Get everything you need to finish it in one call.**

Live: https://please-hold.dankpenta.workers.dev

You write one sentence, like *"Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded."* Please Hold gives you back:

- **A phone script:** the first thing to say, the exact ask, three polite lines for when they say no, and how to close the call.
- **An email** and a **chat message**, ready to send.
- **Your leverage:** hand-written, sourced consumer-rights pointers (US, UK, EU) that match the errand. These are never written by the model.
- **Hold mode:** a full-screen card with your script, a hold timer, and calm hold music generated on your device.
- **After the call:** log the agent's name and reference number, then get a confirmation email and a calendar reminder to check they actually did it. No AI is involved in this step.
- **A lazy ledger:** errands finished, time on hold, words you didn't have to write, money recovered. Stored only in your browser.

## The receipts check

Small models are helpful in the worst way: ask for a cancellation email and they'll add a support phone number, a "within 5 business days" promise, or a consumer protection law. None of it came from you, and some of it is made up.

Please Hold never trusts the model's output. `public/js/verify.js` finds every checkable claim in what Gemma wrote (phone numbers, URLs, emails, amounts, dates, durations, percentages, account numbers, legal-sounding phrases) and compares each one to the user's own words:

| Result | What happens |
|---|---|
| Matches your words | Shown with a dotted underline |
| Contact detail you never gave (phone, URL, email) | **Removed** and replaced with a `[COMPANY PHONE — copy it from your bill]` placeholder |
| Number, date, deadline, or law you never gave | **Highlighted** so you check it or delete it |

Pass 1 extracts facts and must quote the user word for word. Facts whose quote doesn't match, or that sneak in a number, are dropped before pass 2 writes anything.

## Where Gemma runs

| Option | Model | Where your text goes |
|---|---|---|
| Your computer (default when found) | any Gemma you run with [Ollama](https://ollama.com), e.g. `gemma3:4b` | Nowhere |
| Cloudflare (opt-in) | Gemma 4 26B A4B on Workers AI | Cloudflare, not stored or logged by this app |
| In this tab (`?lab=1`, experimental) | Gemma 3 1B via [WebLLM](https://github.com/mlc-ai/web-llm) 0.2.85 + WebGPU | Nowhere |

To use Ollama from the live site, start it with the site allowed as an origin:

```bash
OLLAMA_ORIGINS=https://please-hold.dankpenta.workers.dev ollama serve
```

Windows PowerShell (quit the Ollama tray app first):

```powershell
$env:OLLAMA_ORIGINS="https://please-hold.dankpenta.workers.dev"; ollama serve
```

### Why the in-browser model is behind a flag

I wanted Gemma running in the tab by default. On my test laptop (RTX 4050 6 GB, 16 GB RAM, Chrome) every route failed:

- **Gemma 4 E2B on WebLLM 0.2.86** (the first release with Gemma 4) lost the WebGPU device on the first generated token. So did every other model on 0.2.86. 0.2.85 is stable but has no Gemma 4.
- **Gemma 4 E2B on Transformers.js 4.3.0** downloaded all ~3.3 GB, then the tab crashed while loading the weights.
- **Gemma 3 1B on WebLLM 0.2.85** runs, but it is too small for this job. Under a JSON grammar it emits whitespace forever; without one it echoes the prompt or invents a charge ("$10.99 on Oct 28") the user never mentioned.

Two configuration bugs worth knowing about if you try this yourself: WebLLM's prebuilt Gemma 3 1B record sets both a 4096 context and a 512 sliding window, which WebLLM then rejects (`chatOpts: { context_window_size: 4096, sliding_window_size: -1 }` gets past it). And Hugging Face returns 404 with no CORS headers to model downloads whose `Referer` is a `*.workers.dev` page, so the app sends `Referrer-Policy: no-referrer`.

## Run it

No build step. Static files in `public/`, one small Worker in `src/worker.js` for the opt-in cloud route.

```bash
npm test                  # receipts-check unit tests
node test/eval-cloud.mjs  # 24-errand honesty eval, cloud backend
node test/eval-ollama.mjs # same eval on your local Ollama (default gemma3:4b)
npx wrangler deploy
```

## License

MIT. Gemma is provided under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms); WebLLM is Apache-2.0.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 3: Slow and Steady.
