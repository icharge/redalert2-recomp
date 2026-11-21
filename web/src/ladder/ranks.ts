/**
 * The rank a ladder badge stands for. The server projects a player's rating onto a badge, 0 to 9
 * (`ra2web/server/src/ladder/os.ts`, `badgeFromOs`); `null` is a player with no ranked finish yet.
 * It has no names of its own: these are the game's own rank titles (`GUI:RankPrivate` ... in the
 * ra2web locale), in the order of its `PlayerRankType` (Commander-in-Chief goes to the season's
 * first player from 46 OS).
 */
export const RANK_TITLES = [
  "Private",
  "Corporal",
  "Sergeant",
  "Lieutenant",
  "Major",
  "Colonel",
  "Brigadier General",
  "General",
  "Five-Star General",
  "Commander-in-Chief",
] as const;

export function rankTitle(badge: number | null): string {
  if (badge === null) return "Unranked";
  return (
    RANK_TITLES[Math.min(Math.max(Math.trunc(badge), 0), RANK_TITLES.length - 1)] ?? "Unranked"
  );
}

/** The chevrons the insignia draws: one for the enlisted badges, two for the officers, three above. */
export function chevrons(badge: number | null): number {
  if (badge === null) return 0;
  if (badge <= 2) return 1;
  if (badge <= 5) return 2;
  return 3;
}
