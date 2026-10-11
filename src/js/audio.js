// Procedural audio: every sound and the music box soundtrack are synthesized
// with Web Audio, so there are no audio files and no music-rights questions.
//
// Rules from Playables certification that shape this file:
// - YouTube mute (isAudioEnabled false) must silence everything: we suspend the
//   context, zero the master gain and refuse to schedule new sounds.
// - Nothing may play after onPause: setPaused(true) suspends the context.
// - No sound before the player interacts: the context is created on first input.

const PENTA = [0, 2, 4, 7, 9];
const BASE = 261.63; // C4

/** Frequency of the n-th note of the C major pentatonic scale (0 = C4). */
export function scaleNote(step) {
  const oct = Math.floor(step / 5);
  const deg = ((step % 5) + 5) % 5;
  return BASE * Math.pow(2, oct + PENTA[deg] / 12);
}

const semi = (n) => BASE * Math.pow(2, n / 12);

// C – Am – F – G, as semitone offsets from C4.
const CHORDS = [
  [0, 4, 7, 12, 16],
  [-3, 0, 4, 9, 12],
  [-7, -3, 0, 5, 9],
  [-5, -1, 2, 7, 11],
];
const ARP = [0, 2, 1, 3, 2, 4, 3, 1];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.paused = false;
    this.music = false;
    this.intensity = 0;
    this.nextNote = 0;
    this.step = 0;
  }

  get live() {
    return Boolean(this.ctx) && this.enabled && !this.paused;
  }

  /** Call from a user gesture (pointerdown/keydown). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build();
    }
    this.apply();
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);

    // Soft reverb-ish echo shared by music and chimes.
    this.echo = ctx.createDelay(1);
    this.echo.delayTime.value = 0.27;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    this.echo.connect(damp).connect(fb).connect(this.echo);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    damp.connect(wet).connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // Sparkler hiss while drawing: looping noise through a bandpass.
    const hiss = ctx.createBufferSource();
    hiss.buffer = this.noise;
    hiss.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.8;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    hiss.connect(bp).connect(this.hissGain).connect(this.sfx);
    hiss.start();
  }

  setEnabled(on) {
    this.enabled = on;
    this.apply();
  }

  setPaused(on) {
    this.paused = on;
    this.apply();
  }

  apply() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    if (this.live) {
      ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(0.8, now, 0.05);
      this.nextNote = Math.max(this.nextNote, now + 0.05);
    } else {
      this.master.gain.setValueAtTime(0, now);
      this.hissGain.gain.setValueAtTime(0, now);
      ctx.suspend().catch(() => {});
    }
  }

  // ---------- building blocks ----------

  tone(freq, when, { type = 'triangle', vol = 0.2, attack = 0.004, decay = 0.4, bus = this.sfx, echo = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    o.connect(g).connect(bus);
    if (echo) {
      const e = ctx.createGain();
      e.gain.value = echo;
      g.connect(e).connect(this.echo);
    }
    o.start(when);
    o.stop(when + attack + decay + 0.05);
    return o;
  }

  noiseBurst(when, { vol = 0.2, decay = 0.2, type = 'bandpass', freq = 1200, freqEnd = freq, q = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, when);
    f.frequency.exponentialRampToValueAtTime(freqEnd, when + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(when, Math.random() * 0.5);
    src.stop(when + decay + 0.05);
  }

  // ---------- game sounds ----------

  drawSpeed(pxPerSec) {
    if (!this.live) return;
    const v = Math.min(1, pxPerSec / 2600) * 0.05;
    this.hissGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  capture(count, combo, pure) {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.noiseBurst(now, { vol: 0.12, decay: 0.28, freq: 500, freqEnd: 3500, q: 1.4 });
    const start = 5 + Math.min(combo - 1, 6) * 2;
    const n = Math.min(count, 12);
    for (let i = 0; i < n; i++) {
      const f = scaleNote(start + i);
      this.tone(f, now + 0.03 + i * 0.045, { vol: 0.13, decay: 0.35, echo: 0.5 });
      if (pure) this.tone(f * 2, now + 0.03 + i * 0.045, { type: 'sine', vol: 0.05, decay: 0.3 });
    }
    if (pure && count >= 3) {
      const top = scaleNote(start + n + 2);
      this.tone(top, now + 0.05 + n * 0.045, { type: 'sine', vol: 0.12, decay: 0.9, echo: 0.8 });
    }
  }

  fizzle() {
    if (!this.live) return;
    this.noiseBurst(this.ctx.currentTime, { vol: 0.05, decay: 0.15, freq: 2400, freqEnd: 900 });
  }

  burn() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.45);
    f.type = 'lowpass';
    f.frequency.value = 700;
    g.gain.setValueAtTime(0.28, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(now);
    o.stop(now + 0.55);
    this.noiseBurst(now, { vol: 0.25, decay: 0.35, type: 'lowpass', freq: 1800, freqEnd: 200 });
  }

  snap() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.noiseBurst(now, { vol: 0.3, decay: 0.09, type: 'highpass', freq: 2500 });
    this.tone(880, now, { type: 'square', vol: 0.05, decay: 0.06 });
  }

  batWarn() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.tone(1760, now, { type: 'sine', vol: 0.05, decay: 0.05 });
    this.tone(2093, now + 0.08, { type: 'sine', vol: 0.05, decay: 0.05 });
  }

  golden() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    [12, 14, 16].forEach((s, i) => this.tone(scaleNote(s), now + i * 0.07, { type: 'sine', vol: 0.08, decay: 0.4, echo: 0.6 }));
  }

  frenzy() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 10; i++) {
      this.tone(scaleNote(5 + i), now + i * 0.04, { vol: 0.1, decay: 0.3, echo: 0.5 });
    }
  }

  levelUp() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.tone(scaleNote(7), now, { type: 'sine', vol: 0.1, decay: 0.5, echo: 0.6 });
    this.tone(scaleNote(9), now + 0.12, { type: 'sine', vol: 0.1, decay: 0.7, echo: 0.6 });
  }

  heartbeat() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    this.tone(62, now, { type: 'sine', vol: 0.35, decay: 0.16 });
    this.tone(55, now + 0.17, { type: 'sine', vol: 0.25, decay: 0.2 });
  }

  tap() {
    if (!this.live) return;
    this.tone(scaleNote(9), this.ctx.currentTime, { type: 'sine', vol: 0.08, decay: 0.15 });
  }

  gameOver() {
    if (!this.live) return;
    const now = this.ctx.currentTime;
    [9, 7, 5, 2].forEach((s, i) => this.tone(scaleNote(s), now + i * 0.22, { vol: 0.12, decay: 0.8, echo: 0.7 }));
  }

  // ---------- music box ----------

  startMusic() {
    this.music = true;
    if (this.ctx) this.nextNote = this.ctx.currentTime + 0.1;
  }

  stopMusic() {
    this.music = false;
  }

  /** Schedules the next few music notes. Call every frame. */
  tick(intensity = 0) {
    this.intensity = intensity;
    if (!this.live || !this.music) return;
    const ctx = this.ctx;
    const eighth = intensity > 1 ? 0.19 : 0.3;
    // After a long stall (tab switch, pause) do not try to catch up.
    if (this.nextNote < ctx.currentTime - 0.1) this.nextNote = ctx.currentTime + 0.05;
    while (this.nextNote < ctx.currentTime + 0.25) {
      const t = this.nextNote;
      const bar = Math.floor(this.step / 8) % CHORDS.length;
      const chord = CHORDS[bar];
      const pos = this.step % 8;
      if (pos === 0) {
        this.tone(semi(chord[0] - 24), t, { type: 'sine', vol: 0.16, attack: 0.02, decay: eighth * 7, bus: this.musicBus });
        this.tone(semi(chord[2] - 12), t, { type: 'sine', vol: 0.04, attack: 0.3, decay: eighth * 7, bus: this.musicBus });
      }
      const play = intensity > 0.5 || pos % 2 === 0 || Math.random() < 0.35;
      if (play) {
        const note = chord[ARP[pos]];
        this.tone(semi(note + 12), t, { vol: 0.045, decay: 0.5, bus: this.musicBus, echo: 0.6 });
      }
      if (intensity > 1 && pos % 2 === 1) {
        this.tone(semi(chord[ARP[(pos + 3) % 8]] + 24), t, { type: 'sine', vol: 0.03, decay: 0.25, bus: this.musicBus, echo: 0.4 });
      }
      this.nextNote += eighth;
      this.step++;
    }
  }
}
