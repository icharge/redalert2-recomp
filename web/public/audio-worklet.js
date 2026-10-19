// The game's sound, on the audio thread. The game's mixer thread fills a ring of 16-bit stereo frames in
// the wasm memory (hle_audio_ring_t, src/game/protocol.ts: AudioRing); this plays it. Nothing here blocks or
// allocates per call, and nothing else from the game is needed: the memory is a SharedArrayBuffer.
//
// Header words (Int32): 0 rd, 1 wr, 2 live, 3 capacity, 4 rate, 5 underruns, 6 mixed, 7 low (the fewest frames
// found queued since the page last reset it). The frames start at byte 32.
class RingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { buffer, address } = options.processorOptions;
    this.head = new Int32Array(buffer, address, 8);
    this.pcm = new Int16Array(buffer, address + 32, this.head[3] * 2);
    this.mask = this.head[3] - 1;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const left = out[0];
    const right = out[1] || left;
    const head = this.head;
    if (!left || !Atomics.load(head, 2)) return true; // not live: silence, and leave the ring alone
    const want = left.length;
    const rd = Atomics.load(head, 0);
    const have = (Atomics.load(head, 1) - rd) >>> 0;
    if (have < Atomics.load(head, 7)) Atomics.store(head, 7, have);
    const n = Math.min(want, have);
    const pcm = this.pcm;
    const mask = this.mask;
    for (let i = 0; i < n; i++) {
      const at = ((rd + i) & mask) * 2;
      left[i] = pcm[at] / 32768;
      right[i] = pcm[at + 1] / 32768;
    }
    if (n < want) Atomics.add(head, 5, 1); // short: the rest of this quantum stays silent
    Atomics.store(head, 0, (rd + n) | 0);
    return true;
  }
}

registerProcessor("ra2-ring", RingProcessor);
