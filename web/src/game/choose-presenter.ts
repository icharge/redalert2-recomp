export function presenterKind(search: URLSearchParams, hasWebGl2: boolean): "gl" | "2d" {
  return search.get("presenter") === "2d" || !hasWebGl2 ? "2d" : "gl";
}
