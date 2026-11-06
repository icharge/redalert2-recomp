import type { GameId } from "../storage/install";

/** How each edition looks in the launcher. Paths are relative to the app; pass them through appPath(). */
export interface EditionBrand {
  title: string;
  kicker: string | null;
  short: "RA2" | "YR";
  icon: string;
  background: string;
  /** Fallback tile fill and border when the icon is missing. */
  tile: string;
  tileBorder: string;
}

// The images in brand/ are not in git (EA artwork); every use has a fallback.
export const EDITION_BRAND: Record<GameId, EditionBrand> = {
  ra2: {
    title: "Red Alert 2",
    kicker: null,
    short: "RA2",
    icon: "brand/ra2-icon.png",
    background: "brand/bg-ra2.webp",
    tile: "var(--red-deep)",
    tileBorder: "var(--red-dark)",
  },
  ra2md: {
    title: "Yuri’s Revenge",
    kicker: "EXPANSION",
    short: "YR",
    icon: "brand/yr-icon.png",
    background: "brand/bg-yr.webp",
    tile: "var(--yuri)",
    tileBorder: "var(--yuri-mid)",
  },
};

export const LOGO_SRC = "brand/yurinet.png";
