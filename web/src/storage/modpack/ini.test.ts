import { describe, expect, it } from "vitest";
import { applyIniDiff, parseTextPairs } from "./ini";

const encode = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

describe("applyIniDiff", () => {
  it("replaces changed keys and appends new ones", () => {
    const base = encode(
      "[General]\r\n; comment\r\nSpeed=4\r\nName=Base\r\n\r\n[Video]\r\nWidth=800\r\n",
    );
    const diff = encode("[General]\r\nSpeed=7\r\nNew=1\r\n");
    const merged = text(applyIniDiff(base, diff));
    expect(merged).toContain("; comment");
    expect(merged).toContain("Speed=7");
    expect(merged).toContain("New=1");
    expect(merged).toContain("Name=Base");
    expect(merged).toContain("[Video]");
    expect(merged).toContain("Width=800");
    expect(merged).toContain("\r\n");
  });

  it("matches sections and keys without regard to case", () => {
    const base = encode("[general]\nspeed=4\n");
    const diff = encode("[GENERAL]\nSPEED=9\n");
    expect(text(applyIniDiff(base, diff))).toContain("speed=9");
  });

  it("appends a section the base does not have", () => {
    const base = encode("[General]\nSpeed=4\n");
    const diff = encode("[NewSection]\nKey=Value\n");
    const merged = text(applyIniDiff(base, diff));
    expect(merged).toContain("[NewSection]");
    expect(merged).toContain("Key=Value");
  });

  it("keeps a key with an equals sign in its value", () => {
    const base = encode("[General]\nText=none\n");
    const diff = encode("[General]\nText=a=b\n");
    expect(text(applyIniDiff(base, diff))).toContain("Text=a=b");
  });
});

describe("parseTextPairs", () => {
  it("reads name=value lines and skips comments", () => {
    expect(parseTextPairs(encode("; comment\nA=One\nB = Two\n\n"))).toEqual([
      { name: "A", value: "One" },
      { name: "B", value: "Two" },
    ]);
  });
});
