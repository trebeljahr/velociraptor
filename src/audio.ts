/*
 * Raptor Runner — audio subsystem.
 *
 * A single long-lived object that owns:
 *   • The <audio> element for looping background music
 *   • The <audio> element for rain ambience
 *   • A Web Audio context with pre-decoded buffers for jump + thunder
 *     SFX so layered sounds don't fight the music element
 *
 * State coupling: the only thing the audio module reads from the game
 * state singleton is the "Sound of Silence" achievement streak, which
 * gets broken if the player un-mutes mid-run. To keep this module free
 * of a hard dependency on state.ts, main.ts registers an
 * `onUnmuteDuringRun` callback during init().
 */

import {
  MUTED_KEY,
  MUSIC_MUTED_KEY,
  JUMP_MUTED_KEY,
  RAIN_MUTED_KEY,
  RAIN_AUDIO_MAX_VOLUME,
} from "./constants";
import { saveBoolFlag } from "./persistence";

// webkitAudioContext is still the only Web Audio constructor on old
// Safari — declare it so TS doesn't complain.
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/** Callback invoked when the player un-mutes while a run is in
 *  progress — used to invalidate the Sound of Silence streak. */
export type UnmuteDuringRunCallback = () => void;

// ── Pop-free volume ramps ──────────────────────────────────
//
// `<audio>.pause()` and `.play()` stop/start the waveform at whatever
// amplitude it was at — if that's non-zero (almost always, for music
// and rain loops), the abrupt discontinuity reads as a "plop" click.
// The fix is to ramp the element's volume to 0 before pausing, and
// ramp from 0 up to the target after starting. ~40 ms is enough to
// kill the click without being perceptible as a fade.
//
// A WeakMap-tracked token guards against overlapping fades: if the
// player taps the mute button twice quickly, the in-flight fade
// notices it's been superseded on its next rAF tick and stops
// mutating the element, leaving the new fade in control.

const FADE_MS = 40;
const _activeFade = new WeakMap<HTMLAudioElement, object>();

function rampVolume(
  el: HTMLAudioElement,
  targetVol: number,
  ms: number = FADE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const token = {};
    _activeFade.set(el, token);
    const fromVol = el.volume;
    if (ms <= 0 || fromVol === targetVol) {
      el.volume = targetVol;
      resolve();
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      if (_activeFade.get(el) !== token) {
        // Superseded by a later rampVolume — stop touching the element.
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / ms);
      el.volume = fromVol + (targetVol - fromVol) * t;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        _activeFade.delete(el);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/** Fade an <audio> element's volume down to 0 over FADE_MS, then pause.
 *  The element retains its playback position, so the next rampUpAndPlay
 *  resumes from where it was. Safe to call on a paused element. */
function rampDownAndPause(el: HTMLAudioElement): void {
  if (el.paused) return;
  rampVolume(el, 0).then(() => {
    // Guard against a rampUp starting during the fade: only pause if
    // we're still at/near zero. If another ramp already took over
    // (towards a non-zero target), the WeakMap supersede logic will
    // have stopped our fade early — el.volume may not be 0.
    if (el.volume < 0.001) el.pause();
  });
}

/** Set volume to 0, start playback, then fade up to target over
 *  FADE_MS. If play() rejects (browser autoplay policy, no user
 *  gesture yet), we leave the volume at 0 — the next interaction
 *  will succeed. */
function rampUpAndPlay(el: HTMLAudioElement, targetVol: number): void {
  el.volume = 0;
  const p = el.play();
  const startFade = () => rampVolume(el, targetVol);
  if (p && typeof p.then === "function") {
    p.then(startFade).catch(() => {
      /* leave silent; next interaction will unblock */
    });
  } else {
    startFade();
  }
}

export const audio = {
  // Default to muted so autoplay policies don't complain; the saved
  // preference (if any) is applied later in init() once the music
  // element is in the DOM.
  muted: true as boolean,
  // True once the player has explicitly saved a mute/unmute preference
  // (either by clicking the sound toggle, or by having done so in a
  // previous session). Used to decide whether the Start Game button
  // should auto-unmute (never touched before) or honour the saved
  // value (returning visitor).
  hasSavedPreference: false as boolean,
  music: null as HTMLAudioElement | null,

  // Jump SFX uses the Web Audio API instead of a second <audio>
  // element. Mobile browsers (Chrome Android in particular) only allow
  // one HTMLAudioElement to play at a time — calling jump.play() would
  // pause the music. Web Audio runs through a separate pipeline and
  // can layer any number of sounds on top of the <audio> music
  // without interference.
  musicMuted: false as boolean,
  jumpMuted: false as boolean,
  rainMuted: false as boolean,
  _audioCtx: null as AudioContext | null,
  _jumpBuffer: null as AudioBuffer | null,
  _jumpVolume: 0.67,

  // Main-module-provided hook for achievement invalidation. Left null
  // if the caller hasn't wired it up — audio still works.
  _onUnmuteDuringRun: null as UnmuteDuringRunCallback | null,

  /** Register the Sound-of-Silence invalidation callback. */
  setUnmuteDuringRunHandler(cb: UnmuteDuringRunCallback | null) {
    this._onUnmuteDuringRun = cb;
  },

  init() {
    this.music = document.getElementById(
      "game-music",
    ) as HTMLAudioElement | null;
    if (this.music) this.music.volume = 0.5;
    // Load per-channel mute preferences from localStorage.
    this._loadChannelPrefs();
    // Pre-decode the jump SFX into a Web Audio buffer. The
    // AudioContext is created lazily on the first user gesture
    // (required by autoplay policy), but we fetch + decode the
    // file eagerly so the first jump has zero latency.
    this._preloadJumpBuffer();
    this._preloadThunderBuffer();
    this.initRain();
  },

  _loadChannelPrefs() {
    try {
      const m = window.localStorage.getItem(MUSIC_MUTED_KEY);
      if (m != null) this.musicMuted = m === "1";
      const j = window.localStorage.getItem(JUMP_MUTED_KEY);
      if (j != null) this.jumpMuted = j === "1";
      const r = window.localStorage.getItem(RAIN_MUTED_KEY);
      if (r != null) this.rainMuted = r === "1";
    } catch (e) {
      /* ignored */
    }
  },

  /** Fetch jump.mp3, decode it into an AudioBuffer, and stash it for
   *  instant playback via Web Audio. Falls back gracefully if Web
   *  Audio isn't available (old browsers). */
  _preloadJumpBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/jump.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        // AudioContext may not exist yet (needs user gesture on some
        // browsers). Create it now — decodeAudioData doesn't require
        // a running context, just an instance.
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._jumpBuffer = decoded;
      })
      .catch(() => {
        /* no-op — jump SFX simply won't play */
      });
  },

  _ensureAudioCtx() {
    if (this._audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this._audioCtx = new Ctx();
    } catch (e) {
      /* Web Audio not available */
    }
  },

  setMuted(muted: boolean, persist = true) {
    this.muted = !!muted;
    // If the player unmutes during a live run, they broke the "muted
    // the whole way through" streak for Sound of Silence.
    if (!this.muted && this._onUnmuteDuringRun) {
      this._onUnmuteDuringRun();
    }
    if (persist) {
      saveBoolFlag(MUTED_KEY, this.muted);
      this.hasSavedPreference = true;
    }
    if (!this.music) return;
    if (this.muted || this.musicMuted) {
      rampDownAndPause(this.music);
      if (this.rain && this._isRainPlaying) rampDownAndPause(this.rain);
    } else {
      // Resume the Web Audio context on the first unmute — mobile
      // browsers suspend it until a user gesture unblocks it.
      this._ensureAudioCtx();
      if (this._audioCtx && this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
      rampUpAndPlay(this.music, 0.5);
      // Resume rain if it was playing
      if (this.rain && this._isRainPlaying) {
        rampUpAndPlay(this.rain, RAIN_AUDIO_MAX_VOLUME);
      }
    }
  },

  /** Read the saved mute preference (true/false) from localStorage.
   *  Returns `null` if no preference has ever been saved, so callers
   *  can distinguish "never set" (stay muted for autoplay) from an
   *  explicit previous "unmute" choice (which we honour). */
  loadSavedMuted(): boolean | null {
    try {
      const raw = window.localStorage.getItem(MUTED_KEY);
      if (raw == null) return null;
      return raw === "1";
    } catch (e) {
      return null;
    }
  },

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  },

  playJump() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._jumpBuffer) return;
    // Resume context if it was suspended (e.g. after a tab switch).
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      // Each play creates a fresh source node — they're cheap,
      // single-use objects designed for this pattern. A gain node
      // controls volume without touching the global output.
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._jumpBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = this._jumpVolume;
      src.connect(gain);
      gain.connect(this._audioCtx.destination);
      src.start(0);
    } catch (e) {
      /* swallow — SFX is non-critical */
    }
  },

  /** Unlock the Web Audio context (requires a user gesture). Called
   *  from the Start Game handler so the first jump SFX plays without
   *  delay, regardless of mute state. Also primes rain + music audio
   *  decoders and the Web Audio buffer-source pipeline — see the
   *  individual _primeX / _warmX methods for the why. */
  unlockAudio() {
    this._ensureAudioCtx();
    if (this._audioCtx && this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    this._primeRainAudio();
    this._primeMusicAudio();
    this._warmWebAudioSources();
  },

  _rainPrimed: false as boolean,
  _musicPrimed: false as boolean,
  _webAudioWarmed: false as boolean,

  /**
   * Same decoder-priming trick as _primeRainAudio, applied to the
   * music <audio> element. music2.mp3 is ~4.7MB — large enough that
   * the first play() can stall the start-game click. A silent
   * play+pause inside the user-gesture context warms the decoder.
   *
   * Skipped if music is already playing (unmuted with a saved
   * preference) — priming would fight a live playback.
   */
  _primeMusicAudio() {
    if (this._musicPrimed) return;
    if (!this.music) return;
    // If we're about to unmute and play music for real anyway, the
    // real play() handles decode — don't double up.
    if (!this.muted && !this.musicMuted && this.hasSavedPreference) return;
    this._musicPrimed = true;
    const targetVolume = this.music.volume;
    this.music.volume = 0;
    const restore = () => {
      if (!this.music) return;
      this.music.pause();
      this.music.currentTime = 0;
      this.music.volume = targetVolume;
    };
    try {
      const p = this.music.play();
      if (p && typeof p.then === "function") {
        p.then(restore).catch(() => {
          if (this.music) this.music.volume = targetVolume;
          this._musicPrimed = false;
        });
      } else {
        restore();
      }
    } catch {
      if (this.music) this.music.volume = targetVolume;
      this._musicPrimed = false;
    }
  },

  /**
   * Warm the Web Audio buffer-source pipeline by firing a silent
   * (zero-gain, 10ms) BufferSource → Gain → destination graph for
   * every pre-decoded buffer. Without this, the *first* real
   * playJump() or playThunder() call can stall briefly while
   * Chromium compiles the audio render graph.
   *
   * Buffers may still be null if init() is racing the fetches —
   * safely no-ops per buffer and leaves _webAudioWarmed false so a
   * future unlockAudio call can retry.
   */
  _warmWebAudioSources() {
    if (this._webAudioWarmed) return;
    if (!this._audioCtx) return;
    const buffers = [this._jumpBuffer, this._thunderBuffer];
    if (buffers.every((b) => b == null)) return; // retry later
    this._webAudioWarmed = true;
    for (const buf of buffers) {
      if (!buf) continue;
      try {
        const src = this._audioCtx.createBufferSource();
        src.buffer = buf;
        const gain = this._audioCtx.createGain();
        gain.gain.value = 0;
        src.connect(gain);
        gain.connect(this._audioCtx.destination);
        src.start(0);
        src.stop(this._audioCtx.currentTime + 0.01);
      } catch {
        /* ignore — warming is best-effort */
      }
    }
  },

  /**
   * Force Chromium to decode rain.mp3 *now*, during the start-screen
   * user gesture, instead of when gameplay triggers the first real
   * rain.play() mid-run.
   *
   * Why: rain.mp3 is ~3MB. Even with `preload="auto"` on the <audio>
   * element, Chromium defers the MP3 decode until the first play()
   * call if the element has never been played. That decode happens
   * on the main thread and stalls the game loop for hundreds of
   * milliseconds — long enough for the raptor to die to a cactus
   * that appeared during the hitch.
   *
   * Trick: play at volume 0 and immediately pause. The browser
   * decodes the stream to start playback, then we stop. The decoder
   * state stays warm so the *next* play() (when rain actually
   * starts in-game) is a no-op on the decode path.
   *
   * Idempotent — only runs once per session. If the play() promise
   * rejects (autoplay policy still blocking, non-gesture context),
   * we reset the flag so the next gesture gets another shot.
   */
  _primeRainAudio() {
    if (this._rainPrimed) return;
    if (!this.rain) return;
    this._rainPrimed = true;
    const targetVolume = this.rain.volume;
    this.rain.volume = 0;
    const restore = () => {
      if (!this.rain) return;
      this.rain.pause();
      this.rain.currentTime = 0;
      this.rain.volume = targetVolume;
    };
    try {
      const p = this.rain.play();
      if (p && typeof p.then === "function") {
        p.then(restore).catch(() => {
          if (this.rain) this.rain.volume = targetVolume;
          this._rainPrimed = false;
        });
      } else {
        restore();
      }
    } catch {
      if (this.rain) this.rain.volume = targetVolume;
      this._rainPrimed = false;
    }
  },

  setMusicMuted(muted: boolean) {
    this.musicMuted = !!muted;
    saveBoolFlag(MUSIC_MUTED_KEY, this.musicMuted);
    if (!this.music || this.muted) return;
    if (this.musicMuted) {
      rampDownAndPause(this.music);
      if (this.rain && this._isRainPlaying) rampDownAndPause(this.rain);
    } else {
      rampUpAndPlay(this.music, 0.5);
      if (this.rain && this._isRainPlaying) {
        rampUpAndPlay(this.rain, RAIN_AUDIO_MAX_VOLUME);
      }
    }
  },

  setJumpMuted(muted: boolean) {
    this.jumpMuted = !!muted;
    saveBoolFlag(JUMP_MUTED_KEY, this.jumpMuted);
  },

  setRainMuted(muted: boolean) {
    this.rainMuted = !!muted;
    saveBoolFlag(RAIN_MUTED_KEY, this.rainMuted);
    if (this.rainMuted && this._isRainPlaying) {
      this.stopRain();
    }
  },

  // ── Rain ambience (file-based <audio> element) ──────────────
  rain: null as HTMLAudioElement | null,
  _isRainPlaying: false,

  initRain() {
    this.rain = document.getElementById(
      "rain-audio",
    ) as HTMLAudioElement | null;
    if (this.rain) {
      this.rain.volume = RAIN_AUDIO_MAX_VOLUME;
      this.rain.loop = true;
    }
  },

  startRain() {
    if (this._isRainPlaying) return;
    if (this.muted || this.musicMuted || this.rainMuted) return;
    if (!this.rain) return;
    rampUpAndPlay(this.rain, RAIN_AUDIO_MAX_VOLUME);
    this._isRainPlaying = true;
  },

  stopRain() {
    if (!this._isRainPlaying) return;
    if (this.rain) rampDownAndPause(this.rain);
    this._isRainPlaying = false;
  },

  _thunderBuffer: null as AudioBuffer | null,

  _preloadThunderBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/thunder.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._thunderBuffer = decoded;
      })
      .catch(() => {
        /* thunder SFX simply won't play */
      });
  },

  playThunder() {
    if (this.muted || this.musicMuted) return;
    if (!this._audioCtx || !this._thunderBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._thunderBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(this._audioCtx.destination);
      src.start(0);
    } catch (e) {
      /* non-critical */
    }
  },

  // ── Procedural SFX (no files) ──────────────────────────────
  // Short, cheap one-shots synthesized on the fly. Steps fire twice
  // per run cycle, so going procedural avoids shipping two more MP3s
  // and lets us alternate pitch between feet without extra assets.

  _noiseBuffer: null as AudioBuffer | null,

  /** Lazily create a shared 0.5s white-noise buffer, reused across
   *  every step/hit burst. Samples are cheap but allocating a fresh
   *  buffer per footfall would be silly. */
  _getNoiseBuffer(): AudioBuffer | null {
    if (!this._audioCtx) return null;
    if (this._noiseBuffer) return this._noiseBuffer;
    const len = Math.floor(this._audioCtx.sampleRate * 0.5);
    const buf = this._audioCtx.createBuffer(1, len, this._audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
    return buf;
  },

  /** Footfall: sine thump + short filtered noise scrape. `foot`
   *  biases pitch so alternating calls read as left/right. */
  playStep(foot: "left" | "right" = "left") {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const t0 = ctx.currentTime;

      // Low-frequency thump — body weight hitting sand.
      const thumpFreq = foot === "left" ? 110 : 92;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(thumpFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(thumpFreq * 0.5, t0 + 0.07);
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0, t0);
      oscGain.gain.linearRampToValueAtTime(0.14, t0 + 0.004);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.1);

      // Brief sand-scrape — bandpass noise on top of the thump.
      const noiseBuf = this._getNoiseBuffer();
      if (noiseBuf) {
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1800;
        bp.Q.value = 1.2;
        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0, t0);
        nGain.gain.linearRampToValueAtTime(0.05, t0 + 0.003);
        nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
        noise.connect(bp);
        bp.connect(nGain);
        nGain.connect(ctx.destination);
        noise.start(t0);
        noise.stop(t0 + 0.06);
      }
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Cactus impact: sharp highpass-noise crunch stacked on a
   *  square-wave thud that pitches down — reads as "hit something
   *  spiky and hard". Routed through jumpMuted so the SFX channel
   *  toggle covers it too. */
  playHit() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const t0 = ctx.currentTime;

      // Body-weight thud, pitched down further/faster than a step.
      const thud = ctx.createOscillator();
      thud.type = "square";
      thud.frequency.setValueAtTime(170, t0);
      thud.frequency.exponentialRampToValueAtTime(42, t0 + 0.22);
      const thudGain = ctx.createGain();
      thudGain.gain.setValueAtTime(0, t0);
      thudGain.gain.linearRampToValueAtTime(0.22, t0 + 0.005);
      thudGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.25);
      thud.connect(thudGain);
      thudGain.connect(ctx.destination);
      thud.start(t0);
      thud.stop(t0 + 0.28);

      // Spiky crunch — highpassed noise gives the "scrape against
      // something sharp" character.
      const noiseBuf = this._getNoiseBuffer();
      if (noiseBuf) {
        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 900;
        const nGain = ctx.createGain();
        nGain.gain.setValueAtTime(0, t0);
        nGain.gain.linearRampToValueAtTime(0.2, t0 + 0.002);
        nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
        noise.connect(hp);
        hp.connect(nGain);
        nGain.connect(ctx.destination);
        noise.start(t0);
        noise.stop(t0 + 0.2);
      }
    } catch {
      /* SFX is non-critical */
    }
  },
};
