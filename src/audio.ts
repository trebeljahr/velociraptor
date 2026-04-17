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

/** Set volume to 0, start playback, wait a short silent pre-roll so
 *  the MP3 decoder can stabilize, then fade up to target over FADE_MS.
 *
 *  The pre-roll handles the cold-decoder click: the first few
 *  milliseconds of decoded audio after a fresh play() often contain a
 *  spike (wrong sample alignment, codec priming frames, or the
 *  decoder's discontinuity with silence). Without the pre-roll, those
 *  samples play while the volume ramp is still near zero — attenuated
 *  but still audible on sensitive systems.
 *
 *  If play() rejects (browser autoplay policy, no user gesture yet),
 *  we leave the volume at 0 — the next interaction will succeed. */
const DECODER_PREROLL_MS = 60;
function rampUpAndPlay(el: HTMLAudioElement, targetVol: number): void {
  el.volume = 0;
  const p = el.play();
  const startFade = () => {
    setTimeout(() => rampVolume(el, targetVol), DECODER_PREROLL_MS);
  };
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
    this._preloadHitBuffer();
    this._preloadUfoBuffer();
    this._preloadSantaBuffer();
    this._preloadMeteorBuffer();
    this._preloadCometBuffer();
    this._preloadStepBuffers();
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

  /** Fetch jump.mp3, decode it into an AudioBuffer, and stash it
   *  for instant playback via Web Audio. Falls back gracefully if
   *  Web Audio isn't available (old browsers). */
  _preloadJumpBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/jump.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
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

  /** Plays the original jump.mp3 sample through Web Audio.
   *  _silenceSteps runs first so a running-step sample doesn't
   *  bleed under the jump. */
  playJump() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._jumpBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    this._silenceSteps();
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._jumpBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = this._jumpVolume;
      src.connect(gain);
      gain.connect(this._audioCtx.destination);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
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
   * Runs for every session regardless of saved preference — a
   * returning player with music previously unmuted still has a
   * cold decoder on their first interaction, and the cold-start
   * click reaches the speaker before the real play()'s volume ramp
   * can attenuate it. Priming kills the click by decoding the
   * first frames at volume=0 before anything audible happens.
   */
  _primeMusicAudio() {
    if (this._musicPrimed) return;
    if (!this.music) return;
    this._musicPrimed = true;
    const targetVolume = this.music.volume;
    this.music.volume = 0;
    // If the user is (or will stay) muted, tear the silent playback
    // back down once the decoder is warm. If they're unmuted, setMuted
    // is running rampUpAndPlay in parallel on the same element —
    // pausing/rewinding here would silence the real play that's in
    // flight (on mobile the cold-decoder play() resolves after the
    // real one fires, so this restore lands AFTER the ramp has
    // started). Leaving the element playing at volume=0 lets the
    // rampUpAndPlay take over cleanly.
    const restore = () => {
      if (!this.music) return;
      this.music.volume = targetVolume;
      if (this.muted || this.musicMuted) {
        this.music.pause();
        this.music.currentTime = 0;
      }
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
    // Only tear the silent playback back down if rain isn't currently
    // in its "on" state. If startRain() ran during priming (e.g. the
    // session began inside a rain window and the restored weather
    // state triggered it), pausing here would kill the real rain.
    const restore = () => {
      if (!this.rain) return;
      this.rain.volume = targetVolume;
      if (!this._isRainPlaying) {
        this.rain.pause();
        this.rain.currentTime = 0;
      }
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

  // ── Footstep SFX (freesound_community grass-loop excerpts) ──
  // Four ~300ms samples trimmed from a public-domain "running in
  // grass" loop. playStep rotates through them with a small pitch
  // + volume jitter so the cadence doesn't loop perceptibly.
  _stepBuffers: [] as AudioBuffer[],
  _stepLastIdx: -1,
  // In-flight step sources tracked so playJump can fade them out —
  // prevents the "running" sample bleeding over the jump cue.
  _activeStepGains: new Set<GainNode>(),

  _preloadStepBuffers() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    const paths = [
      "assets/step-left.mp3",
      "assets/step-right.mp3",
      "assets/step-a.mp3",
      "assets/step-b.mp3",
    ];
    this._stepBuffers = new Array(paths.length).fill(null);
    paths.forEach((path, i) => {
      fetch(path)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          this._ensureAudioCtx();
          if (!this._audioCtx) return;
          return this._audioCtx.decodeAudioData(buf);
        })
        .then((decoded) => {
          if (decoded) this._stepBuffers[i] = decoded;
        })
        .catch(() => {
          /* individual step sample just won't play */
        });
    });
  },

  /** Footfall: plays one of the grass-step samples with a small
   *  pitch + volume jitter so repeated cycles don't sound tiled.
   *  The `foot` hint is kept for call-site readability but the
   *  sample choice is round-robin across all loaded buffers,
   *  which is what actually breaks the monotony. */
  playStep(_foot: "left" | "right" = "left") {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || this._audioCtx.state !== "running") return;
    // Pick a buffer other than the last one played — avoids the
    // same waveform back-to-back. Falls back to random on very
    // first call before any have loaded.
    const loaded = this._stepBuffers
      .map((b, i) => ({ b, i }))
      .filter((x) => x.b);
    if (loaded.length === 0) return;
    let pick = loaded[Math.floor(Math.random() * loaded.length)];
    if (loaded.length > 1) {
      while (pick.i === this._stepLastIdx) {
        pick = loaded[Math.floor(Math.random() * loaded.length)];
      }
    }
    this._stepLastIdx = pick.i;
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = pick.b;
      // ±4 % playback rate → ~70-cent pitch wobble, imperceptible
      // individually but effective at hiding the tile.
      src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.08;
      const gain = ctx.createGain();
      // ±12 % gain jitter around a lower baseline — the previous
      // 1.8 was too loud against the music.
      gain.gain.value = 0.75 * (0.88 + Math.random() * 0.24);
      src.connect(gain);
      gain.connect(ctx.destination);
      this._activeStepGains.add(gain);
      src.onended = () => {
        this._activeStepGains.delete(gain);
        try { src.disconnect(); gain.disconnect(); } catch {}
      };
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Quickly fade out every in-flight step source. Called from
   *  playJump so the jump cue isn't sharing the mix with a
   *  leftover running-grass sample. */
  _silenceSteps() {
    if (!this._audioCtx) return;
    const now = this._audioCtx.currentTime;
    for (const g of this._activeStepGains) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.02);
      } catch {}
    }
  },

  // ── Cactus-collision SFX (Universfield marimba lose) ───────
  _hitBuffer: null as AudioBuffer | null,

  _preloadHitBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/hit.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._hitBuffer = decoded;
      })
      .catch(() => {
        /* hit SFX simply won't play */
      });
  },

  /** Cactus impact: plays the licensed marimba "lose" sample.
   *  Routed through jumpMuted so the SFX channel toggle covers it.
   *
   *  Skips the first ~100ms of the source buffer because the MP3 has
   *  a silent pickup before the first marimba note — without the
   *  offset the "plink" lands perceptibly after the collision. */
  playHit() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._hitBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._hitBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.6;
      src.connect(gain);
      gain.connect(this._audioCtx.destination);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch {}
      };
      src.start(0, 0.1);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── UFO rare-event SFX (SoundReality ufo) ──────────────────
  _ufoBuffer: null as AudioBuffer | null,
  _ufoSource: null as AudioBufferSourceNode | null,
  _ufoGain: null as GainNode | null,

  _preloadUfoBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/ufo.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._ufoBuffer = decoded;
      })
      .catch(() => {
        /* UFO SFX simply won't play */
      });
  },

  /** Start the UFO hover/beam sample. Stored as a handle so stopUfo
   *  can cut it short when the event ends (or the player dies). */
  playUfo() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._ufoBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    // Already playing? Let the existing source run.
    if (this._ufoSource) return;
    try {
      const src = this._audioCtx.createBufferSource();
      src.buffer = this._ufoBuffer;
      const gain = this._audioCtx.createGain();
      gain.gain.value = 0.28;
      src.connect(gain);
      gain.connect(this._audioCtx.destination);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch {}
        if (this._ufoSource === src) {
          this._ufoSource = null;
          this._ufoGain = null;
        }
      };
      this._ufoSource = src;
      this._ufoGain = gain;
      // Skip ~80ms of silent lead-in at the start of the sample.
      src.start(0, 0.08);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Fade out and stop the UFO sample. Called when the UFO event
   *  ends or the player dies mid-abduction. */
  stopUfo() {
    if (!this._audioCtx || !this._ufoSource || !this._ufoGain) return;
    const ctx = this._audioCtx;
    const src = this._ufoSource;
    const gain = this._ufoGain;
    const t = ctx.currentTime;
    try {
      // Brief ramp to zero, then stop — avoids a click on abrupt cut.
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.08);
      src.stop(t + 0.09);
    } catch {
      try { src.stop(0); } catch {}
    }
    this._ufoSource = null;
    this._ufoGain = null;
  },

  // ── Santa rare-event SFX (DRAGON-STUDIO jingle bells) ─────
  _santaBuffer: null as AudioBuffer | null,

  _preloadSantaBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/santa.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._santaBuffer = decoded;
      })
      .catch(() => {
        /* santa SFX simply won't play */
      });
  },

  // Santa plays as a loop that fades in when santa appears and
  // fades out when santa leaves the screen. Kept as handles so
  // stopSanta can time the fade-out from the caller.
  _santaSource: null as AudioBufferSourceNode | null,
  _santaGain: null as GainNode | null,
  _santaTargetGain: 0.4,

  /** Start the looping sleigh-bell sample with a 0.3s fade-in.
   *  stopSanta is responsible for the fade-out when the santa
   *  event reaches the far side of the screen. */
  playSanta() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._santaBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    if (this._santaSource) return;
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = this._santaBuffer;
      src.loop = true;
      const gain = ctx.createGain();
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(this._santaTargetGain, t0 + 0.3);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch {}
        if (this._santaSource === src) {
          this._santaSource = null;
          this._santaGain = null;
        }
      };
      this._santaSource = src;
      this._santaGain = gain;
      src.start(0);
    } catch {
      /* SFX is non-critical */
    }
  },

  /** Fade out and stop the looping sleigh bells. */
  stopSanta() {
    if (!this._audioCtx || !this._santaSource || !this._santaGain) return;
    const ctx = this._audioCtx;
    const src = this._santaSource;
    const gain = this._santaGain;
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.35);
      src.stop(t + 0.36);
    } catch {
      try { src.stop(0); } catch {}
    }
    this._santaSource = null;
    this._santaGain = null;
  },

  // ── Meteor-impact SFX (DRAGON-STUDIO nuclear explosion) ───
  _meteorBuffer: null as AudioBuffer | null,

  _preloadMeteorBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/meteor.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._meteorBuffer = decoded;
      })
      .catch(() => {
        /* meteor SFX simply won't play */
      });
  },

  /** Play the explosion sample at meteor impact. Sample is ~7.5s,
   *  longer than the event lifetime (~5s) — the tail rumble lingers
   *  after the visual fades, which reads as aftermath weight.
   *
   *  Scheduled ~400ms after the call to simulate sound-over-distance
   *  lag: the flash hits the retina instantly but the boom takes
   *  time to travel across the desert. */
  playMeteor() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._meteorBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    try {
      const ctx = this._audioCtx;
      const src = ctx.createBufferSource();
      src.buffer = this._meteorBuffer;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.onended = () => {
        try { src.disconnect(); gain.disconnect(); } catch {}
      };
      // Schedule against the Web Audio clock so the gap tracks the
      // audio tick exactly (no setTimeout drift). First arg is
      // absolute start time, second is buffer offset (skip silent
      // lead-in).
      src.start(ctx.currentTime + 0.2, 0.05);
    } catch {
      /* SFX is non-critical */
    }
  },

  // ── Comet rare-event SFX (Alice_soundz glitter) ────────────
  _cometBuffer: null as AudioBuffer | null,

  _preloadCometBuffer() {
    if (
      typeof AudioContext === "undefined" &&
      typeof window.webkitAudioContext === "undefined"
    )
      return;
    fetch("assets/comet.mp3")
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this._ensureAudioCtx();
        if (!this._audioCtx) return;
        return this._audioCtx.decodeAudioData(buf);
      })
      .then((decoded) => {
        if (decoded) this._cometBuffer = decoded;
      })
      .catch(() => {
        /* comet SFX simply won't play */
      });
  },

  // Comet uses the same looping + fade pattern as santa/ufo, but
  // with an ~800 ms delay between spawn and audible onset so the
  // shimmer picks up after the comet has actually entered the
  // visible area instead of while it's still offscreen right.
  _cometSource: null as AudioBufferSourceNode | null,
  _cometGain: null as GainNode | null,
  _cometStartTimer: null as number | null,
  _cometTargetGain: 0.4,

  /** Schedule a delayed, fading-in looped glitter cue for a comet.
   *  Cancellable by stopComet whether or not the delayed start
   *  has fired yet. */
  playComet() {
    if (this.muted || this.jumpMuted) return;
    if (!this._audioCtx || !this._cometBuffer) return;
    if (this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
    if (this._cometSource || this._cometStartTimer !== null) return;
    const START_DELAY_MS = 800;
    this._cometStartTimer = window.setTimeout(() => {
      this._cometStartTimer = null;
      if (!this._audioCtx || !this._cometBuffer) return;
      try {
        const ctx = this._audioCtx;
        const src = ctx.createBufferSource();
        src.buffer = this._cometBuffer;
        // Loop just the active-sparkle body. The sample decays to
        // near-silence between 2.53 s and 3.95 s and previously
        // read as a dip-then-restart when wrapped back to 0.54.
        src.loop = true;
        src.loopStart = 0.6;
        src.loopEnd = 2.53;
        const gain = ctx.createGain();
        const t0 = ctx.currentTime;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(this._cometTargetGain, t0 + 0.4);
        src.connect(gain);
        gain.connect(ctx.destination);
        src.onended = () => {
          try { src.disconnect(); gain.disconnect(); } catch {}
          if (this._cometSource === src) {
            this._cometSource = null;
            this._cometGain = null;
          }
        };
        this._cometSource = src;
        this._cometGain = gain;
        src.start(0, 0.6);
      } catch {
        /* SFX is non-critical */
      }
    }, START_DELAY_MS);
  },

  /** Fade out the comet loop and stop it. Also cancels a pending
   *  delayed start if the event ends before the sound began. */
  stopComet() {
    if (this._cometStartTimer !== null) {
      window.clearTimeout(this._cometStartTimer);
      this._cometStartTimer = null;
      return;
    }
    if (!this._audioCtx || !this._cometSource || !this._cometGain) return;
    const ctx = this._audioCtx;
    const src = this._cometSource;
    const gain = this._cometGain;
    const t = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.45);
      src.stop(t + 0.46);
    } catch {
      try { src.stop(0); } catch {}
    }
    this._cometSource = null;
    this._cometGain = null;
  },
};
