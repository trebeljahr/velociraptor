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
      try {
        window.localStorage.setItem(MUTED_KEY, this.muted ? "1" : "0");
        this.hasSavedPreference = true;
      } catch (e) {
        /* ignored — storage may be unavailable */
      }
    }
    if (!this.music) return;
    if (this.muted || this.musicMuted) {
      this.music.pause();
      if (this.rain && this._isRainPlaying) this.rain.pause();
    } else {
      // Resume the Web Audio context on the first unmute — mobile
      // browsers suspend it until a user gesture unblocks it.
      this._ensureAudioCtx();
      if (this._audioCtx && this._audioCtx.state === "suspended") {
        this._audioCtx.resume().catch(() => {});
      }
      // .play() returns a Promise that can reject (autoplay policy,
      // user-gesture required). Swallow the rejection — the next user
      // interaction will succeed.
      const p = this.music.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      // Resume rain if it was playing
      if (this.rain && this._isRainPlaying) {
        const rp = this.rain.play();
        if (rp && typeof rp.catch === "function") rp.catch(() => {});
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
   *  delay, regardless of mute state. */
  unlockAudio() {
    this._ensureAudioCtx();
    if (this._audioCtx && this._audioCtx.state === "suspended") {
      this._audioCtx.resume().catch(() => {});
    }
  },

  setMusicMuted(muted: boolean) {
    this.musicMuted = !!muted;
    try {
      window.localStorage.setItem(
        MUSIC_MUTED_KEY,
        this.musicMuted ? "1" : "0",
      );
    } catch (e) {
      /* ignored */
    }
    if (!this.music || this.muted) return;
    if (this.musicMuted) {
      this.music.pause();
      if (this.rain && this._isRainPlaying) this.rain.pause();
    } else {
      const p = this.music.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      if (this.rain && this._isRainPlaying) {
        const rp = this.rain.play();
        if (rp && typeof rp.catch === "function") rp.catch(() => {});
      }
    }
  },

  setJumpMuted(muted: boolean) {
    this.jumpMuted = !!muted;
    try {
      window.localStorage.setItem(
        JUMP_MUTED_KEY,
        this.jumpMuted ? "1" : "0",
      );
    } catch (e) {
      /* ignored */
    }
  },

  setRainMuted(muted: boolean) {
    this.rainMuted = !!muted;
    try {
      window.localStorage.setItem(
        RAIN_MUTED_KEY,
        this.rainMuted ? "1" : "0",
      );
    } catch (e) {
      /* ignored */
    }
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
    const p = this.rain.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    this._isRainPlaying = true;
  },

  stopRain() {
    if (!this._isRainPlaying) return;
    if (this.rain) this.rain.pause();
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
};
