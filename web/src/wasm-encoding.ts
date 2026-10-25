export type WasmEncoding = "br" | "gzip" | "identity";
export type WasmEncodingAvailability = { br: boolean; gzip: boolean; identity?: boolean };

const preference: Record<WasmEncoding, number> = {
  br: 0,
  gzip: 1,
  identity: 2,
};

function quality(value: string): number {
  const normalized = value.trim();
  if (/^0(?:\.\d{0,3})?$/.test(normalized)) return Number(normalized);
  if (/^1(?:\.0{0,3})?$/.test(normalized)) return 1;
  return 0;
}

function parseAcceptEncoding(header: string): Map<string, number> {
  const codings = new Map<string, number>();
  for (const item of header.split(",")) {
    const [rawName, ...parameters] = item.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;

    let q = 1;
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*(.*?)\s*$/i.exec(parameter);
      if (match) q = quality(match[1] ?? "");
    }
    codings.set(name, q);
  }
  return codings;
}

/** Select an HTTP representation; equal quality favors Brotli, then gzip, then identity. */
export function chooseWasmEncoding(
  acceptEncoding: string | null,
  available: WasmEncodingAvailability = { br: true, gzip: true, identity: true },
): WasmEncoding | null {
  if (!acceptEncoding?.trim()) return available.identity === false ? null : "identity";

  const codings = parseAcceptEncoding(acceptEncoding);
  const wildcard = codings.get("*");
  const candidates: Array<{ encoding: WasmEncoding; q: number }> = [
    { encoding: "br", q: available.br ? (codings.get("br") ?? wildcard ?? 0) : 0 },
    { encoding: "gzip", q: available.gzip ? (codings.get("gzip") ?? wildcard ?? 0) : 0 },
    {
      encoding: "identity",
      q: available.identity === false ? 0 : (codings.get("identity") ?? (wildcard === 0 ? 0 : 1)),
    },
  ];

  candidates.sort(
    (left, right) => right.q - left.q || preference[left.encoding] - preference[right.encoding],
  );
  return candidates[0]?.q ? (candidates[0].encoding ?? null) : null;
}
