// Independent implementation of the bzip2 decoder used by the XIF container
// (docs/mod-packs.md §1). Written from the published bzip2 format description;
// no XCC Utilities code (GPLv3) was copied or translated. MIT.

export class Bzip2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Bzip2Error";
  }
}

const BLOCK_MAGIC = 0x314159265359;
const EOS_MAGIC = 0x177245385090;
const MAX_CODE_LENGTH = 22;
const MAX_RUN = 1 << 21;

/** MSB-first bit reader over the compressed stream. */
class Bits {
  private bit = 0;
  private pos: number;

  constructor(
    private readonly data: Uint8Array,
    start = 0,
  ) {
    this.pos = start;
  }

  bit1(): number {
    if (this.pos >= this.data.length)
      throw new Bzip2Error("The bzip2 stream ended inside a block.");
    const value = (this.data[this.pos]! >>> (7 - this.bit)) & 1;
    if (++this.bit === 8) {
      this.bit = 0;
      this.pos++;
    }
    return value;
  }

  bits(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) value = (value << 1) | this.bit1();
    return value;
  }
}

/** Canonical Huffman table: symbols ordered by code length, then value. */
interface Huffman {
  minLength: number;
  maxLength: number;
  count: Int32Array;
  firstIndex: Int32Array;
  firstCode: Int32Array;
  symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array): Huffman {
  const count = new Int32Array(MAX_CODE_LENGTH + 1);
  let minLength = MAX_CODE_LENGTH + 1;
  let maxLength = 0;
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const length = lengths[symbol]!;
    if (length < 1 || length > MAX_CODE_LENGTH)
      throw new Bzip2Error("A bzip2 code length is out of range.");
    count[length] = (count[length] ?? 0) + 1;
    if (length < minLength) minLength = length;
    if (length > maxLength) maxLength = length;
  }

  const firstIndex = new Int32Array(MAX_CODE_LENGTH + 1);
  const firstCode = new Int32Array(MAX_CODE_LENGTH + 1);
  const symbols = new Int32Array(lengths.length);
  let index = 0;
  let code = 0;
  for (let length = minLength; length <= maxLength; length++) {
    firstIndex[length] = index;
    firstCode[length] = code;
    for (let symbol = 0; symbol < lengths.length; symbol++)
      if (lengths[symbol] === length) symbols[index++] = symbol;
    code = (code + (count[length] ?? 0)) << 1;
  }
  if (index !== lengths.length) throw new Bzip2Error("A bzip2 code table is incomplete.");
  return { minLength, maxLength, count, firstIndex, firstCode, symbols };
}

function decodeSymbol(bits: Bits, table: Huffman): number {
  let length = table.minLength;
  let code = bits.bits(length);
  for (;;) {
    const first = table.firstCode[length]!;
    const count = table.count[length]!;
    if (code >= first && code < first + count)
      return table.symbols[table.firstIndex[length]! + code - first]!;
    if (length === table.maxLength)
      throw new Bzip2Error("A bzip2 Huffman code is not in the table.");
    length++;
    code = (code << 1) | bits.bit1();
  }
}

/** Holds the decompressed output, with the size cap the caller allows. */
class Sink {
  private chunks: Uint8Array[] = [];
  private length = 0;

  constructor(private readonly max: number) {}

  write(data: Uint8Array): void {
    if (this.length + data.length > this.max)
      throw new Bzip2Error("The bzip2 data is larger than the allowed limit.");
    this.chunks.push(data.slice());
    this.length += data.length;
  }

  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/**
 * Decompresses one bzip2 stream. `maxOutput` bounds the result, so a crafted
 * file cannot exhaust the browser's memory before the caller sees it.
 */
export function bunzip2(data: Uint8Array, maxOutput = 512 * 1024 * 1024): Uint8Array {
  if (data.length < 4 || data[0] !== 0x42 || data[1] !== 0x5a || data[2] !== 0x68)
    throw new Bzip2Error("This is not a bzip2 stream.");
  const level = data[3]! - 0x30;
  if (level < 1 || level > 9) throw new Bzip2Error("The bzip2 block size is out of range.");

  const bits = new Bits(data, 4);
  const sink = new Sink(maxOutput);
  for (;;) {
    const magic = bits.bits(24) * 0x1000000 + bits.bits(24);
    if (magic === EOS_MAGIC) {
      bits.bits(32); // combined CRC; not verified (see the note above)
      break;
    }
    if (magic !== BLOCK_MAGIC) throw new Bzip2Error("A bzip2 block marker is missing.");
    decodeBlock(bits, level * 100000, sink);
  }
  return sink.result();
}

function decodeBlock(bits: Bits, maxBlock: number, sink: Sink): void {
  bits.bits(32); // block CRC; not verified
  if (bits.bit1()) throw new Bzip2Error("Randomised bzip2 blocks are not supported.");
  const origPtr = bits.bits(24);

  const inUse = new Uint8Array(256);
  const inUse16 = bits.bits(16);
  for (let group = 0; group < 16; group++) {
    if (!(inUse16 & (1 << (15 - group)))) continue;
    const groupBits = bits.bits(16);
    for (let bit = 0; bit < 16; bit++)
      if (groupBits & (1 << (15 - bit))) inUse[group * 16 + bit] = 1;
  }

  const sequence = new Uint8Array(256);
  let used = 0;
  for (let symbol = 0; symbol < 256; symbol++) if (inUse[symbol]) sequence[used++] = symbol;
  if (!used) throw new Bzip2Error("A bzip2 block has no symbols.");
  const mtf = sequence.slice(0, used);
  const alphaSize = used + 2;

  const groupCount = bits.bits(3);
  if (groupCount < 2 || groupCount > 6)
    throw new Bzip2Error("A bzip2 block has a bad table count.");
  const selectorCount = bits.bits(15);
  if (!selectorCount) throw new Bzip2Error("A bzip2 block has no selectors.");

  const selectors = new Uint8Array(selectorCount);
  const groupOrder = new Uint8Array(groupCount);
  for (let i = 0; i < groupCount; i++) groupOrder[i] = i;
  for (let i = 0; i < selectorCount; i++) {
    let at = 0;
    while (bits.bit1()) {
      at++;
      if (at >= groupCount) throw new Bzip2Error("A bzip2 selector is out of range.");
    }
    const value = groupOrder[at]!;
    for (let k = at; k > 0; k--) groupOrder[k] = groupOrder[k - 1]!;
    groupOrder[0] = value;
    selectors[i] = value;
  }

  const tables: Huffman[] = [];
  for (let group = 0; group < groupCount; group++) {
    const lengths = new Uint8Array(alphaSize);
    let current = bits.bits(5);
    for (let symbol = 0; symbol < alphaSize; symbol++) {
      for (;;) {
        if (!bits.bit1()) break;
        current += bits.bit1() ? -1 : 1;
        if (current < 1 || current > MAX_CODE_LENGTH)
          throw new Bzip2Error("A bzip2 code length is out of range.");
      }
      lengths[symbol] = current;
    }
    tables.push(buildHuffman(lengths));
  }

  const encoded = new Uint8Array(maxBlock);
  let length = 0;
  const endOfBlock = used + 1;
  let group = -1;
  let left = 0;
  let selector = 0;
  const nextSymbol = (): number => {
    if (left === 0) {
      group++;
      if (group >= selectorCount)
        throw new Bzip2Error("A bzip2 block uses more selectors than it has.");
      selector = selectors[group]!;
      left = 50;
    }
    left--;
    return decodeSymbol(bits, tables[selector]!);
  };

  for (;;) {
    let symbol = nextSymbol();
    if (symbol === endOfBlock) break;
    if (symbol <= 1) {
      let run = -1;
      let weight = 1;
      do {
        if (weight >= MAX_RUN) throw new Bzip2Error("A bzip2 run is too long.");
        run += (symbol === 0 ? 1 : 2) * weight;
        weight *= 2;
        symbol = nextSymbol();
      } while (symbol <= 1);
      run++;
      if (length + run > maxBlock)
        throw new Bzip2Error("A bzip2 block is larger than its level allows.");
      encoded.fill(mtf[0]!, length, length + run);
      length += run;
      if (symbol === endOfBlock) break;
    }
    const at = symbol - 1;
    if (at < 1 || at >= used) throw new Bzip2Error("A bzip2 symbol is out of range.");
    const value = mtf[at]!;
    for (let k = at; k > 0; k--) mtf[k] = mtf[k - 1]!;
    mtf[0] = value;
    if (length >= maxBlock) throw new Bzip2Error("A bzip2 block is larger than its level allows.");
    encoded[length++] = value;
  }

  if (length === 0) return;
  if (origPtr >= length) throw new Bzip2Error("A bzip2 block points outside itself.");

  // Inverse Burrows-Wheeler transform.
  const counts = new Int32Array(256);
  for (let i = 0; i < length; i++) {
    const value = encoded[i]!;
    counts[value] = (counts[value] ?? 0) + 1;
  }
  const starts = new Int32Array(256);
  let sum = 0;
  for (let value = 0; value < 256; value++) {
    starts[value] = sum;
    sum += counts[value] ?? 0;
  }
  const next = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    const value = encoded[i]!;
    next[starts[value]!++] = i;
  }
  const bwt = new Uint8Array(length);
  let at = origPtr;
  for (let i = 0; i < length; i++) {
    at = next[at]!;
    bwt[i] = encoded[at]!;
  }

  // Undo the first run-length encoding (4 equal bytes, then a count of extras).
  let output = new Uint8Array(Math.max(1024, length));
  let written = 0;
  const ensure = (extra: number) => {
    if (written + extra <= output.length) return;
    const bigger = new Uint8Array(Math.max(output.length * 2, written + extra));
    bigger.set(output.subarray(0, written));
    output = bigger;
  };
  let read = 0;
  while (read < length) {
    const value = bwt[read++]!;
    ensure(1);
    output[written++] = value;
    if (
      read + 2 < length &&
      bwt[read] === value &&
      bwt[read + 1] === value &&
      bwt[read + 2] === value
    ) {
      // The group is four copies in all: the one just written and these three.
      read += 3;
      ensure(3);
      output.fill(value, written, written + 3);
      written += 3;
      const extra = read < length ? bwt[read++]! : 0;
      ensure(extra);
      output.fill(value, written, written + extra);
      written += extra;
    }
  }
  sink.write(output.subarray(0, written));
}
