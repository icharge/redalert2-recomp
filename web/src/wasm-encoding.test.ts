import { describe, expect, it } from "vitest";
import { chooseWasmEncoding } from "./wasm-encoding";

describe("chooseWasmEncoding", () => {
  it("uses Brotli first when the client accepts both encodings equally", () => {
    expect(chooseWasmEncoding("br, gzip")).toBe("br");
  });

  it("uses the encoding with the client's higher quality value", () => {
    expect(chooseWasmEncoding("gzip;q=1, br;q=0.5")).toBe("gzip");
  });

  it("falls back to gzip when Brotli is excluded", () => {
    expect(chooseWasmEncoding("br;q=0, gzip")).toBe("gzip");
  });

  it("falls back to identity when both compressed encodings are excluded", () => {
    expect(chooseWasmEncoding("br;q=0, gzip;q=0")).toBe("identity");
  });

  it("uses Brotli for a wildcard when no coding is excluded", () => {
    expect(chooseWasmEncoding("*;q=1")).toBe("br");
  });

  it("keeps identity available when wildcard excludes compression but identity is explicit", () => {
    expect(chooseWasmEncoding("*;q=0, identity;q=1")).toBe("identity");
  });

  it("returns identity when the request has no Accept-Encoding header", () => {
    expect(chooseWasmEncoding(null)).toBe("identity");
    expect(chooseWasmEncoding("")).toBe("identity");
  });

  it("returns null if the request excludes every available representation", () => {
    expect(chooseWasmEncoding("br;q=0, gzip;q=0, identity;q=0")).toBeNull();
    expect(chooseWasmEncoding("*;q=0")).toBeNull();
  });

  it("falls back to gzip when an accepted Brotli sidecar is missing", () => {
    expect(chooseWasmEncoding("br, gzip", { br: false, gzip: true })).toBe("gzip");
  });

  it("falls back to identity when both accepted sidecars are missing", () => {
    expect(chooseWasmEncoding("br, gzip", { br: false, gzip: false })).toBe("identity");
  });

  it("treats invalid quality values as unacceptable", () => {
    expect(chooseWasmEncoding("br;q=1.1, gzip;q=0")).toBe("identity");
  });
});
