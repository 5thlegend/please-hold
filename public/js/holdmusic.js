// Please Hold — your hold music, not theirs.
// Generated live with Web Audio: four slow major-seventh chords, a soft bell once every
// few seconds, a lowpass that breathes. No files, no network, no sudden loud bits.

const CHORDS = [
  [261.63, 329.63, 392.0, 493.88], // Cmaj7
  [220.0, 261.63, 329.63, 392.0], // Am7
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [196.0, 246.94, 293.66, 329.63], // G6
];
const BELL = [523.25, 587.33, 659.25, 783.99, 880.0];
const BAR = 8; // seconds per chord: sloth tempo

export class HoldMusic {
  constructor() {
    this.ctx = null;
    this.timer = null;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 4);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 900;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.05;
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();
    this.filter.connect(this.master).connect(ctx.destination);
    this.step = 0;
    this.next = ctx.currentTime + 0.1;
    this.schedule();
  }

  schedule() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + BAR) {
      this.chord(CHORDS[this.step % CHORDS.length], this.next);
      for (let i = 0; i < 2; i++) {
        if (Math.random() < 0.7) this.bell(BELL[Math.floor(Math.random() * BELL.length)], this.next + 1 + i * 3.5 + Math.random());
      }
      this.next += BAR;
      this.step++;
    }
    this.timer = setTimeout(() => this.schedule(), 2000);
  }

  chord(freqs, t) {
    for (const f of freqs) {
      for (const detune of [-6, 6]) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "triangle";
        o.frequency.value = f / 2;
        o.detune.value = detune;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 3);
        g.gain.linearRampToValueAtTime(0.0, t + BAR + 2);
        o.connect(g).connect(this.filter);
        o.start(t);
        o.stop(t + BAR + 2.2);
      }
    }
  }

  bell(f, t) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 4.1);
  }

  stop() {
    if (!this.ctx) return;
    clearTimeout(this.timer);
    const ctx = this.ctx;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
    setTimeout(() => ctx.close(), 1700);
    this.ctx = null;
  }
}
