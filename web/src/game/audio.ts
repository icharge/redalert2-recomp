import type { WasmMemory } from "./presenter";
import { AUDIO_PCM_OFFSET, AudioRing, type Ra2Exports } from "./protocol";

/** The game mixes at this rate (HLE_AUDIO_RATE): the context runs at it, so the worklet never resamples. */
export const AUDIO_RATE = 44100;
export const WORKLET_NAME = "ra2-ring";

/**
 * - `starting`: the context is being made
 * - `suspended`: the browser holds sound until the player clicks or presses a key
 * - `running`: the worklet plays what the game mixes
 * - `unavailable`: no sound here (no audio, no worklet, or memory that cannot be shared); the game goes on silent
 */
export type AudioState = "starting" | "suspended" | "running" | "unavailable";

/** What GameAudio needs of the browser: the parts a test replaces. */
export interface AudioEnv {
  createContext(rate: number): AudioContext;
  workletUrl: string;
  /** every key or click on the page, in the capture phase; returns how to stop listening */
  onGesture(listener: () => void): () => void;
}

export function browserAudioEnv(base = import.meta.env.BASE_URL): AudioEnv {
  return {
    createContext: (rate) => new AudioContext({ sampleRate: rate, latencyHint: "interactive" }),
    workletUrl: `${base}audio-worklet.js`,
    onGesture: (listener) => {
      const events = ["pointerdown", "keydown", "touchend"] as const;
      for (const type of events) window.addEventListener(type, listener, true);
      return () => {
        for (const type of events) window.removeEventListener(type, listener, true);
      };
    },
  };
}

export type AudioExports = Pick<Ra2Exports, "ra2_audio" | "ra2_audio_live">;

/**
 * The page's end of the game's sound: an AudioContext with a worklet that plays the ring the game's
 * mixer thread fills (docs/web/architecture.md, "Sound"). The game never waits for it: until the context
 * runs, the mixer keeps its own time and drops what it mixes.
 */
export class GameAudio {
  private current: AudioState = "starting";
  private readonly listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private stopGesture: (() => void) | null = null;
  private head: Int32Array | null = null;
  private closed = false;

  constructor(
    private readonly exports: AudioExports,
    private readonly memory: () => WasmMemory,
    private readonly env: AudioEnv = browserAudioEnv(),
  ) {}

  get state(): AudioState {
    return this.current;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Worklet quanta that found the ring short, so far (audible as a click). */
  underruns(): number {
    return this.head ? Atomics.load(this.head, AudioRing.underruns) : 0;
  }

  /** The ring's header, for the end-to-end checks (e2e/audio.mjs). */
  stats(): Record<keyof typeof AudioRing, number> | null {
    const head = this.head;
    if (!head) return null;
    const read = (name: keyof typeof AudioRing) => Atomics.load(head, AudioRing[name]) >>> 0;
    return {
      rd: read("rd"),
      wr: read("wr"),
      live: read("live"),
      capacity: read("capacity"),
      rate: read("rate"),
      underruns: read("underruns"),
      mixed: read("mixed"),
      low: read("low"),
    };
  }

  /** Forgets the low-water mark: the fewest frames the worklet found queued since this was last called. */
  resetLow(): void {
    if (this.head)
      Atomics.store(this.head, AudioRing.low, Atomics.load(this.head, AudioRing.capacity));
  }

  /** The loudest sample (0 to 1) now in the ring: does the game make any sound? For the end-to-end checks. */
  peak(): number {
    const head = this.head;
    if (!head) return 0;
    const frames = Atomics.load(head, AudioRing.capacity);
    const pcm = new Int16Array(head.buffer, head.byteOffset + AUDIO_PCM_OFFSET, frames * 2);
    let loudest = 0;
    for (let i = 0; i < pcm.length; i++) loudest = Math.max(loudest, Math.abs(pcm[i] ?? 0));
    return loudest / 32768;
  }

  async start(): Promise<void> {
    try {
      const buffer = this.memory().HEAPU8.buffer;
      if (typeof SharedArrayBuffer === "undefined" || !(buffer instanceof SharedArrayBuffer)) {
        throw new Error("the game's memory is not shared");
      }
      const address = this.exports.ra2_audio();
      this.head = new Int32Array(buffer, address, 8);
      const context = this.env.createContext(AUDIO_RATE);
      this.context = context;
      await context.audioWorklet.addModule(this.env.workletUrl);
      if (this.closed) return;
      const node = new AudioWorkletNode(context, WORKLET_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { buffer, address },
      });
      node.connect(context.destination);
      context.addEventListener("statechange", this.follow);
      this.follow();
      if (context.state !== "running") void this.resume(); // allowed at once when the page has been clicked before
    } catch (error) {
      console.warn("no sound:", error);
      this.set("unavailable");
    }
  }

  /** Asks the browser to start the sound: it agrees from inside a click or key press. */
  async resume(): Promise<void> {
    try {
      await this.context?.resume();
    } catch {
      // still held: the next gesture tries again
    }
    this.follow();
  }

  close(notifyRuntime = true): void {
    if (this.closed) return;
    this.closed = true;
    this.disarm();
    if (notifyRuntime) this.exports.ra2_audio_live(0);
    this.context?.removeEventListener("statechange", this.follow);
    void this.context?.close().catch(() => {});
    this.context = null;
    this.head = null;
  }

  private follow = (): void => {
    if (this.closed) return;
    const state = this.context?.state;
    if (state === "running") {
      this.exports.ra2_audio_live(1);
      this.disarm();
      this.set("running");
    } else if (state === "suspended" || state === "interrupted") {
      this.exports.ra2_audio_live(0);
      this.arm();
      this.set("suspended");
    } else if (state === "closed") {
      this.exports.ra2_audio_live(0);
      this.set("unavailable");
    }
  };

  /** While the browser holds the sound, the next key or click asks it to start. */
  private arm(): void {
    this.stopGesture ??= this.env.onGesture(() => void this.resume());
  }

  private disarm(): void {
    this.stopGesture?.();
    this.stopGesture = null;
  }

  private set(state: AudioState): void {
    if (state === this.current) return;
    this.current = state;
    for (const listener of this.listeners) listener();
  }
}
