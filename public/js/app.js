import { Engine, BACKENDS, webgpuSupport, ollamaModels } from "./engine.js";
import { FACTS_SCHEMA, KIT_SCHEMA, factsMessages, kitMessages, GET_A_HUMAN, leverageFor, followUpEmail, reminderIcs } from "./kit.js";
import { checkText, checkFacts, summarize } from "./verify.js";
import { HoldMusic } from "./holdmusic.js";

const $ = (id) => document.getElementById(id);
const engine = new Engine();
const music = new HoldMusic();

const EXAMPLES = [
  "Lumen Fitness charged me $49.99 on Oct 3 even though I cancelled on Sept 28. Member #448210. I want it refunded.",
  "My Northwind Internet bill went from $65 to $95 this month with no warning. Account 7731-0042. I want the old price back.",
  "I returned a coffee grinder to Brightway Home on Sept 30 (order BH-20931) and still haven't gotten my $89 refund.",
  "StreamBox keeps charging me $15.99 a month for a plan I never signed up for. Cancel it and refund the last two charges.",
];

// --- tiny storage helpers (storage can be blocked; the app works without it) ---
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = { input: "", facts: null, kit: null, region: "US", t0: 0, words: 0, holdStart: 0, talkStart: 0, holdSec: 0, timer: null };

// --- setup ------------------------------------------------------------------
for (const ex of EXAMPLES) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = ex.length > 64 ? ex.slice(0, 62) + "…" : ex;
  b.title = ex;
  b.onclick = () => { $("errand").value = ex; $("errand").focus(); };
  $("examples").append(b);
}
$("region").value = store.get("ph.region", "US");
$("errand").value = store.get("ph.draft", "");
$("errand").addEventListener("input", () => store.set("ph.draft", $("errand").value));

// The in-tab 1B model is too small for this job (see README), so it only shows with ?lab=1.
const LAB = new URLSearchParams(location.search).has("lab");
const OLLAMA_CMD = `OLLAMA_ORIGINS=${location.origin} ollama serve`;
const OLLAMA_CMD_WIN = `$env:OLLAMA_ORIGINS="${location.origin}"; ollama serve`;

async function setupBackends() {
  const [gpu, olla] = await Promise.all([webgpuSupport(), ollamaModels()]);
  const avail = {
    "device-1": LAB && gpu.ok && gpu.f16,
    ollama: olla.length > 0,
    cloud: true,
  };
  const desc = {
    "device-1": ["Experimental. Runs in this tab, 0.6 GB once. Too small to be reliable here.", "stays on this device"],
    ollama: [olla.length ? `Found ${olla[0]}${olla.length > 1 ? " and " + (olla.length - 1) + " more" : ""} on this machine. Free and private.` : "Free and private. Install Ollama, run ollama pull gemma3:4b, then start it with the command below.", "stays on this device"],
    cloud: ["Try it right now, on any device. Runs Gemma 4 26B on Cloudflare.", "sends your text to Cloudflare"],
  };
  const saved = store.get("ph.backend", null);
  // Local first; the cloud is never picked for you.
  let pick = saved && avail[saved] ? saved : avail.ollama ? "ollama" : null;
  $("backendOpts").innerHTML = "";
  for (const k of Object.keys(BACKENDS)) {
    if (k === "device-1" && !LAB) continue;
    const el = document.createElement("label");
    el.className = "opt" + (avail[k] ? "" : " disabled");
    el.innerHTML = `<input type="radio" name="backend" value="${k}" ${avail[k] ? "" : "disabled"} ${pick === k ? "checked" : ""}>
      <b>${BACKENDS[k].label}</b><span>${desc[k][0]}</span>
      <em class="badge ${k === "cloud" ? "cloud" : ""}">${desc[k][1]}</em>`;
    $("backendOpts").append(el);
  }
  if (!olla.length) {
    const p = document.createElement("div");
    p.className = "ollama-cmd";
    p.innerHTML = `<span>To keep everything on your computer, start Ollama like this, then reload:</span>
      <code id="ollamaCmd">${esc(OLLAMA_CMD)}</code><span>Windows PowerShell (quit the Ollama tray app first):</span><code>${esc(OLLAMA_CMD_WIN)}</code><button type="button" class="ghost small" id="copyOllama">Copy Mac/Linux command</button>`;
    $("backendOpts").after(p);
    $("copyOllama").onclick = async () => {
      try { await navigator.clipboard.writeText(OLLAMA_CMD); $("copyOllama").textContent = "Copied"; } catch { $("copyOllama").textContent = "Select it"; }
    };
  }
}
setupBackends();

// --- tabs -------------------------------------------------------------------
for (const t of document.querySelectorAll(".tabs button")) {
  t.onclick = () => showTab(t.dataset.tab);
}
function showTab(name) {
  for (const t of document.querySelectorAll(".tabs button")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
  for (const p of document.querySelectorAll(".pane")) p.classList.toggle("hidden", p.dataset.pane !== name);
}

// --- rendering --------------------------------------------------------------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TIP = {
  verified: "From your own words",
  unverified: "Not in what you typed. Check it or delete it.",
  caught: "Gemma added contact details you never gave. Removed: look them up yourself.",
};

function renderChecked(result) {
  return result.segments
    .map((s) => {
      const t = esc(s.text).replace(/\[[A-Z][^\]]*\]/g, (m) => `<span class="ph">${m}</span>`);
      if (!s.status) return t;
      const cls = { verified: "v", unverified: "u", caught: "c" }[s.status];
      const title = s.status === "caught" ? `${TIP.caught} (was: ${s.original})` : TIP[s.status];
      return `<mark class="${cls}" title="${esc(title)}">${t}</mark>`;
    })
    .join("");
}

function step(name, status) {
  const li = document.querySelector(`[data-step="${name}"]`);
  li.classList.remove("active", "done");
  if (status) li.classList.add(status);
}

// --- the main flow ----------------------------------------------------------
$("go").onclick = run;

async function run() {
  const input = $("errand").value.trim();
  if (input.length < 12) {
    $("errand").focus();
    $("errand").placeholder = "Tell me who, what happened, and what you want. One sentence is enough.";
    return;
  }
  const choice = document.querySelector('input[name="backend"]:checked')?.value;
  if (!choice) {
    alert("Pick where Gemma should run first.");
    return;
  }
  store.set("ph.backend", choice);
  store.set("ph.region", $("region").value);
  Object.assign(state, { input, region: $("region").value });

  $("go").disabled = true;
  $("kit").classList.add("hidden");
  $("progress").classList.remove("hidden");
  for (const li of document.querySelectorAll("#steps li")) li.classList.remove("active", "done");
  $("tokens").textContent = "";

  try {
    step("load", "active");
    const tl = performance.now();
    await engine.load(choice, (p, text) => {
      $("loadBar").style.width = `${Math.round(p * 100)}%`;
      $("loadText").textContent = text.replace(/\[.*?\]\s*/, "").slice(0, 120);
    });
    const loadSec = (performance.now() - tl) / 1000;
    $("engineChip").textContent = `Gemma: ${engine.modelName.replace(/-q4f16_1-MLC$/, "")}`;
    $("engineChip").classList.add("on");
    step("load", "done");

    state.t0 = performance.now();
    step("facts", "active");
    const raw = await engine.json(factsMessages(input), FACTS_SCHEMA, {
      maxTokens: 500,
      onToken: (n) => ($("tokens").textContent = `Gemma is reading… ${n} tokens`),
    });
    step("facts", "done");

    step("check1", "active");
    const { kept, dropped } = checkFacts(raw.facts, input);
    const facts = { ...raw, facts: kept, dropped };
    // The goal and fallback are model-written too: run them through the same check.
    facts.goalCheck = checkText(raw.goal || "", input);
    facts.fallbackCheck = checkText(raw.fallback_goal || "", input);
    state.facts = facts;
    step("check1", "done");

    step("kit", "active");
    const kit = await engine.json(kitMessages(input, facts), KIT_SCHEMA, {
      maxTokens: 800,
      onToken: (n) => ($("tokens").textContent = `Gemma is writing… ${n} tokens`),
    });
    step("kit", "done");

    step("check2", "active");
    const checked = {
      emailSubject: checkText(kit.email_subject || "", input),
      emailBody: checkText(kit.email_body || "", input),
      chat: checkText(kit.chat_message || "", input),
      opener: checkText(kit.phone_opener || "", input),
      ask: checkText(kit.phone_ask || "", input),
      refuse: (kit.if_they_refuse || []).slice(0, 4).map((l) => checkText(l, input)),
      close: checkText(kit.phone_close || "", input),
    };
    state.kit = checked;
    step("check2", "done");

    const secs = (performance.now() - state.t0) / 1000;
    render(facts, checked, secs, loadSec);
  } catch (e) {
    console.error(e);
    $("tokens").textContent = `Something went wrong: ${e.message}`;
  } finally {
    $("go").disabled = false;
  }
}

function render(facts, k, secs, loadSec) {
  const all = [k.emailSubject, k.emailBody, k.chat, k.opener, k.ask, ...k.refuse, k.close, facts.goalCheck, facts.fallbackCheck];
  const s = summarize(all);
  const kitText = [k.emailBody.text, k.chat.text, k.opener.text, k.ask.text, ...k.refuse.map((r) => r.text), k.close.text].join(" ");
  const wordsOut = kitText.split(/\s+/).filter(Boolean).length;
  const wordsIn = state.input.split(/\s+/).filter(Boolean).length;
  state.words = wordsOut;

  $("receipt").innerHTML = `
    <h2>Your kit is ready. You typed ${wordsIn} words; Please Hold wrote ${wordsOut}.</h2>
    <ul class="stats">
      <li><b>${secs.toFixed(0)}s</b>to write${loadSec > 5 ? ` (plus ${loadSec.toFixed(0)}s loading Gemma)` : ""}</li>
      <li><b>${s.verified}</b>details checked against your words</li>
      <li><b>${s.caught}</b>made-up contact details removed</li>
      <li><b>${s.unverified}</b>flagged for you to check</li>
      <li><b>${facts.dropped.length}</b>facts dropped for not matching what you said</li>
      <li><b>${s.placeholders}</b>blanks for you to fill</li>
    </ul>
    <p class="legend"><mark class="v">dotted</mark> = from your words · <mark class="u">yellow</mark> = not from you, check it · <mark class="c">red</mark> = removed · <span class="ph">[BLANK]</span> = fill in. Everything is editable.</p>`;

  $("goal").innerHTML = renderChecked(facts.goalCheck);
  $("fallback").innerHTML = renderChecked(facts.fallbackCheck);
  $("missing").innerHTML = (facts.missing || []).slice(0, 3).map((m) => `<li>${esc(m)}</li>`).join("") || "<li>Nothing else needed</li>";
  $("factCount").textContent = `(${facts.facts.length} kept${facts.dropped.length ? `, ${facts.dropped.length} dropped` : ""})`;
  $("factList").innerHTML =
    facts.facts.map((f) => `<li>${esc(f.fact)}</li>`).join("") +
    facts.dropped.map((f) => `<li class="dropped" title="Dropped: Gemma's quote didn't match your words">${esc(f.fact)}</li>`).join("");

  $("emailSubject").innerHTML = renderChecked(k.emailSubject);
  $("emailBody").innerHTML = renderChecked(k.emailBody);
  $("chatMsg").innerHTML = renderChecked(k.chat);
  $("phoneOpener").innerHTML = renderChecked(k.opener);
  $("phoneAsk").innerHTML = renderChecked(k.ask);
  $("phoneRefuse").innerHTML = k.refuse.map((r) => `<div>${renderChecked(r)}</div>`).join("");
  $("phoneClose").innerHTML = renderChecked(k.close);
  $("tips").innerHTML = GET_A_HUMAN.map((t) => `<li>${esc(t)}</li>`).join("");

  const lev = leverageFor(facts.errand_type, state.region);
  $("leverage").innerHTML = lev.length
    ? lev.map((l) => `<div class="lev"><h4>${esc(l.title)}</h4><p>${esc(l.body)}</p><a href="${l.url}" target="_blank" rel="noopener">Source: ${esc(l.source)}</a></div>`).join("")
    : `<p class="note">No hand-checked rights pointer for this kind of errand in your region yet. Your strongest leverage is a calm, specific request, a reference number, and a written confirmation.</p>`;

  updateMailto();
  $("progress").classList.add("hidden");
  $("kit").classList.remove("hidden");
  showTab("phone");
  $("kit").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateMailto() {
  const subject = $("emailSubject").innerText.trim();
  const body = $("emailBody").innerText.trim();
  $("mailto").href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
$("emailSubject").addEventListener("input", updateMailto);
$("emailBody").addEventListener("input", updateMailto);

for (const b of document.querySelectorAll("[data-copy]")) {
  b.onclick = async () => {
    const text = b.dataset.copy === "email" ? `Subject: ${$("emailSubject").innerText.trim()}\n\n${$("emailBody").innerText.trim()}` : $("chatMsg").innerText.trim();
    try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
    setTimeout(() => (b.textContent = b.dataset.copy === "email" ? "Copy email" : "Copy message"), 1800);
  };
}

// --- hold mode --------------------------------------------------------------
let wakeLock = null;
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

$("startCall").onclick = async () => {
  $("hOpener").textContent = $("phoneOpener").innerText;
  $("hAsk").textContent = $("phoneAsk").innerText;
  $("hRefuse").innerHTML = [...$("phoneRefuse").children].map((d) => `<li>${esc(d.innerText)}</li>`).join("");
  $("hClose").textContent = $("phoneClose").innerText;
  $("hold").classList.remove("hidden");
  $("holdLabel").textContent = "On hold";
  $("answered").classList.remove("hidden");
  state.holdStart = Date.now();
  state.talkStart = 0;
  music.start();
  $("musicToggle").textContent = "Music: on";
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    const from = state.talkStart || state.holdStart;
    $("holdTime").textContent = fmt((Date.now() - from) / 1000);
  }, 500);
};

$("musicToggle").onclick = () => {
  if (music.ctx) { music.stop(); $("musicToggle").textContent = "Music: off"; }
  else { music.start(); $("musicToggle").textContent = "Music: on"; }
};

$("answered").onclick = () => {
  state.holdSec = (Date.now() - state.holdStart) / 1000;
  state.talkStart = Date.now();
  music.stop();
  $("musicToggle").textContent = "Music: off";
  $("holdLabel").textContent = `On the call · held ${fmt(state.holdSec)}`;
  $("answered").classList.add("hidden");
};

$("callDone").onclick = () => {
  if (!state.talkStart) state.holdSec = (Date.now() - state.holdStart) / 1000;
  clearInterval(state.timer);
  music.stop();
  try { wakeLock?.release(); } catch {}
  $("hold").classList.add("hidden");
  showTab("after");
  $("logRep").focus();
};

// --- after the call ---------------------------------------------------------
function followUp() {
  return followUpEmail({
    company: state.facts?.company,
    goal: $("goal").innerText.trim(),
    rep: $("logRep").value.trim(),
    ref: $("logRef").value.trim(),
    when: state.holdStart || Date.now(),
    agreed: $("logAgreed").value.trim(),
  });
}

$("makeFollowUp").onclick = () => {
  const f = followUp();
  $("followUp").textContent = `Subject: ${f.subject}\n\n${f.body}`;
  $("followUp").classList.remove("hidden");
};

$("makeIcs").onclick = () => {
  const company = state.facts?.company || "the company";
  const ics = reminderIcs({
    title: `Check: did ${company} do what they promised?`,
    details: `Asked for: ${$("goal").innerText.trim()}\nAgreed: ${$("logAgreed").value.trim() || "(not noted)"}\nRef: ${$("logRef").value.trim() || "(none)"}\nAgent: ${$("logRep").value.trim() || "(not noted)"}`,
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = "please-hold-reminder.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

$("finish").onclick = () => {
  const l = store.get("ph.ledger", { errands: 0, holdSec: 0, money: 0, words: 0 });
  l.errands += 1;
  l.holdSec += Math.round(state.holdSec || 0);
  l.money += parseFloat($("logMoney").value.replace(/[^\d.]/g, "")) || 0;
  l.words += state.words || 0;
  store.set("ph.ledger", l);
  store.set("ph.draft", "");
  renderLedger();
  $("finish").textContent = "Done. Go lie down.";
  $("finish").disabled = true;
};

function renderLedger() {
  const l = store.get("ph.ledger", null);
  if (!l || !l.errands) { $("ledger").classList.add("hidden"); return; }
  $("ledger").classList.remove("hidden");
  $("ledger").innerHTML = `<span class="title">Your lazy ledger (saved on this device only)</span>
    <span><b>${l.errands}</b>${l.errands === 1 ? "errand" : "errands"} finished</span>
    <span><b>${fmt(l.holdSec)}</b>spent on hold</span>
    <span><b>${l.words}</b>words you didn't have to write</span>
    ${l.money ? `<span><b>$${l.money.toFixed(2)}</b>recovered</span>` : ""}`;
}
renderLedger();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// ?debug=1 exposes the real pipeline so the on-device eval can drive it (see test/eval-browser.js).
if (new URLSearchParams(location.search).has("debug")) {
  window.PH = { engine, factsMessages, kitMessages, FACTS_SCHEMA, KIT_SCHEMA, checkFacts, checkText, summarize };
}
