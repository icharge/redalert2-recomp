/** Public URLs live under the deployment base, independent of the current route. */
export function appPath(relative = "", base = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/?$/, "/")}${relative.replace(/^\/+/, "")}`;
}

export function slotFromPath(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const slot = Number(value);
  return Number.isSafeInteger(slot) ? slot : null;
}

export const gamePath = (edition?: string) =>
  `/game${edition ? `?edition=${encodeURIComponent(edition)}` : ""}`;
