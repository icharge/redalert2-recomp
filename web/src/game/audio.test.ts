import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIO_RATE, GameAudio, type AudioEnv } from "./audio";

/** An AudioContext that starts held, as a browser's does before the first click. */
class FakeContext extends EventTarget {
  state: AudioContextState = "suspended";
  audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
  destination = {};
  resume = vi.fn(() => {
    if (this.allowed) this.become("running");
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.become("closed");
    return Promise.resolve();
  });
  allowed = false;
  become(state: AudioContextState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeNode {
  static made: { name: string; options: AudioWorkletNodeOptions }[] = [];
  constructor(_context: unknown, name: string, options: AudioWorkletNodeOptions) {
    FakeNode.made.push({ name, options });
  }
  connect = vi.fn();
}

function setup() {
  const context = new FakeContext();
  let gesture: (() => void) | null = null;
  const env: AudioEnv = {
    createContext: vi.fn(() => context as unknown as AudioContext),
    workletUrl: "/audio-worklet.js",
    onGesture: (listener) => {
      gesture = listener;
      return () => {
        gesture = null;
      };
    },
  };
  const heap = new Uint8Array(new SharedArrayBuffer(4096));
  const exports = { ra2_audio: vi.fn(() => 64), ra2_audio_live: vi.fn() };
  const audio = new GameAudio(
    exports,
    () => ({ HEAPU8: heap, HEAP32: new Int32Array(heap.buffer) }),
    env,
  );
  return { audio, context, env, exports, heap, press: () => gesture?.() };
}

beforeEach(() => {
  FakeNode.made = [];
  vi.stubGlobal("AudioWorkletNode", FakeNode);
});
afterEach(() => vi.unstubAllGlobals());

describe("GameAudio", () => {
  it("can close after runtime shutdown without calling dead exports", async () => {
    const { audio, context, exports } = setup();
    await audio.start();
    exports.ra2_audio_live.mockClear();
    audio.close(false);
    expect(context.close).toHaveBeenCalled();
    expect(exports.ra2_audio_live).not.toHaveBeenCalled();
    expect(audio.stats()).toBeNull();
  });
  it("makes a context at the game's rate and a worklet over the game's ring", async () => {
    const { audio, env, heap } = setup();
    await audio.start();
    expect(env.createContext).toHaveBeenCalledWith(AUDIO_RATE);
    const [node] = FakeNode.made;
    expect(node?.name).toBe("ra2-ring");
    expect(node?.options.processorOptions).toEqual({ buffer: heap.buffer, address: 64 });
    expect(node?.options.outputChannelCount).toEqual([2]);
  });

  it("holds the ring back from the worklet until the browser lets the sound start", async () => {
    const { audio, context, exports, press } = setup();
    await audio.start();
    expect(audio.state).toBe("suspended");
    expect(exports.ra2_audio_live).not.toHaveBeenCalledWith(1);
    context.allowed = true;
    press();
    await vi.waitFor(() => expect(audio.state).toBe("running"));
    expect(exports.ra2_audio_live).toHaveBeenLastCalledWith(1);
    expect(press()).toBeUndefined(); // listening stopped
  });

  it("starts at once when the browser agrees without a click", async () => {
    const { audio, context, exports } = setup();
    context.allowed = true;
    await audio.start();
    expect(audio.state).toBe("running");
    expect(exports.ra2_audio_live).toHaveBeenLastCalledWith(1);
  });

  it("goes back to waiting for a click when the browser suspends the sound again", async () => {
    const { audio, context, exports } = setup();
    context.allowed = true;
    await audio.start();
    context.allowed = false;
    context.become("suspended");
    expect(audio.state).toBe("suspended");
    expect(exports.ra2_audio_live).toHaveBeenLastCalledWith(0);
    context.allowed = true;
    // a gesture is being listened for again
    const resumed = context.resume.mock.calls.length;
    await audio.resume();
    expect(context.resume.mock.calls.length).toBe(resumed + 1);
    expect(audio.state).toBe("running");
  });

  it("tells its listeners when the state changes", async () => {
    const { audio, context } = setup();
    const seen: string[] = [];
    audio.subscribe(() => seen.push(audio.state));
    context.allowed = true;
    await audio.start();
    expect(seen).toEqual(["suspended", "running"]);
  });

  it("goes on silent when the memory cannot be shared", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { exports, env } = setup();
    const plain = new Uint8Array(64);
    const audio = new GameAudio(
      exports,
      () => ({ HEAPU8: plain, HEAP32: new Int32Array(16) }),
      env,
    );
    await audio.start();
    expect(audio.state).toBe("unavailable");
    expect(env.createContext).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads the underrun count the worklet keeps, and lets go on close", async () => {
    const { audio, context, exports, heap } = setup();
    await audio.start();
    expect(audio.underruns()).toBe(0);
    new Int32Array(heap.buffer, 64, 8)[5] = 3;
    expect(audio.underruns()).toBe(3);
    audio.close();
    expect(context.close).toHaveBeenCalled();
    expect(exports.ra2_audio_live).toHaveBeenLastCalledWith(0);
  });
});
