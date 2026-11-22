import { describe, expect, it } from "vitest";
import { bunzip2, Bzip2Error } from "./bzip2";

import { decodeBase64 } from "./fixtures";

// Generated once with Python's bz2 module; the inputs are described, so the
// expected output is checked without a second decoder.
const vectors: { name: string; text: string; data: Uint8Array; size: number }[] = [
  {
    name: "a short text",
    text: "XCC mod pack fixture\n",
    data: decodeBase64(
      "QlpoOTFBWSZTWXjcyFgAAANXgAAQQAAIAABALyrWQCAAIpoaZNMJ6hTTIxMTERtKWzhYlnfEl4AfF3JFOFCQeNzIWA==",
    ),
    size: 21,
  },
  {
    name: "empty",
    text: "",
    data: decodeBase64("QlpoORdyRThQkAAAAAA="),
    size: 0,
  },
  {
    name: "repeated INI lines",
    text: "[General]\nName=Fixture\nSpeed=7\n".repeat(300),
    data: decodeBase64(
      "QlpoOTFBWSZTWS/OnaAABnHPgAAQAIIBgQgKJidWQDAA2AUDTQyMmIUDTQyMmIFKqZGg9EZGngpGCkZlI6lIwUjMpGRSPRSNCCtikcFIwUjQpGRSPhSMikcFI2KRwUj2UjcUjsUjcpHQpH4pHJSOSkclI/i7kinChIF+dO0A",
    ),
    size: 9300,
  },
  {
    name: "every byte, repeated (MTF)",
    text: "",
    data: decodeBase64(
      "QlpoOTFBWSZTWfvqx7wAABP/////////////////////////////////////////////0AP+AAAAASYACYAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTAATAAEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASYACYAAmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACTAATAAEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAClVVAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/wmACYCJgQmBiYIJgomDCYOJhAmEiYUJhYmGCYaJhwmHiYgJiImJCYmJigmKiYsJi4mMCYyJjQmNiY4JjomPCY+JkAmQiZEJkYmSCZKJkwmTiZQJlImVCZWJlgmWiZcJl4mYCZiJmQmZiZoJmombCZuJnAmciZ0JnYmeCZ6JnwmfiaAJoImhCaGJogmiiaMJo4mkCaSJpQmliaYJpomnCaeJqAmoiakJqYmqCaqJqwmriawJrImtCa2Jrgmuia8Jr4mwCbCJsQmxibIJsomzCbOJtAm0ibUJtYm2CbaJtwm3ibgJuIm5CbmJugm6ibsJu4m8CbyJvQm9ib4Jvom/Cb+JwAnAicEJwYnCCcKJwwnDicQJxInFCcWJxgnGiccJx4nICciJyQnJicoJyonLCcuJzAnMic0JzYnOCc6JzwnPidAJ0InRCdGJ0gnSidMJ04nUCdSJ1QnVidYJ1onXCdeJ2AnYidkJ2YnaCdqJ2wnbidwJ3IndCd2J3gneid8J34ngCeCJ4QnhieIJ4onjCeOJ5AnkieUJ5YnmCeaJ5wnniegJ6InpCemJ6gnqiesJ64nsCeyJ7Qntie4J7onvCe+J8AnwifEJ8YnyCfKJ8wnzifQJ9In1CfWJ9gn2ifcJ94n4CfiJ+Qn5ifoJ+on7CfuJ/An8if0J/Yn+Cf6J/wn/i7kinChIffVj3g",
    ),
    size: 10240,
  },
  {
    name: "two blocks",
    text: "",
    data: decodeBase64(
      "QlpoOTFBWSZTWf7Tyv0A27iEAD/AIABwQwIE1UAeVCETmZQhE1KEIm5QhE5KEIm1QhE6qEInlQhE+YoKyTKazUtkUCgLcdggAf4BAAOCGBAmqgD0BSlYgKUrMBSlagKUrcBSlb5AUpXQFKV4BSlfF3JFOFCQVMsf/g==",
    ),
    size: 1_200_000,
  },
];

function latin1(data: Uint8Array): string {
  let text = "";
  for (const value of data) text += String.fromCharCode(value);
  return text;
}

describe("bunzip2", () => {
  for (const vector of vectors) {
    it(`decompresses ${vector.name}`, () => {
      const out = bunzip2(vector.data);
      expect(out.length).toBe(vector.size);
      if (vector.text) expect(latin1(out)).toBe(vector.text);
    });
  }

  it("decompresses every byte value in order", () => {
    const out = bunzip2(vectors[3]!.data);
    const expected = new Uint8Array(256 * 40);
    for (let i = 0; i < expected.length; i++) expected[i] = i % 256;
    expect(out).toEqual(expected);
  });

  it("decompresses a stream with more than one block", () => {
    const out = bunzip2(vectors[4]!.data);
    expect(out.length).toBe(1_200_000);
    for (let at = 0; at < out.length; at += 8) {
      expect(latin1(out.subarray(at, at + 8))).toBe("ABCDEFGH");
    }
  });

  it("decompresses the tree fixture", () => {
    const out = bunzip2(
      decodeBase64("QlpoOTFBWSZTWaFw04gAAAvBAHnAAGAgACEpqNkCDJiG45J5UVqMR9NBvC7kinChIULhpxA="),
    );
    expect(out.length).toBe(41);
  });

  it("refuses a stream that is not bzip2", () => {
    expect(() => bunzip2(new Uint8Array([0x58, 0x49, 0x46, 0x1a]))).toThrow(Bzip2Error);
  });

  it("refuses a truncated stream", () => {
    expect(() => bunzip2(vectors[0]!.data.subarray(0, 12))).toThrow(Bzip2Error);
  });

  it("stops at the output limit", () => {
    expect(() => bunzip2(vectors[4]!.data, 1000)).toThrow(/larger than the allowed limit/);
  });
});
