import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { BrandImage } from "../../components/BrandImage";
import { EDITION_BRAND, LOGO_SRC } from "../../components/brand";
import { appPath } from "../../paths";
import type { GameRecord } from "../../storage/manifest";
import styles from "./Shell.module.css";

export type Estimate = () => Promise<{ quota?: number; usage?: number }>;

const TABS = [
  { label: "PLAY", to: "/", end: true },
  { label: "MODS", to: "/mods", end: false },
  { label: "GAME", to: "/manage", end: false },
];

// some browsers (and insecure pages) have no storage estimate: then no figure is shown
const browserEstimate: Estimate = async () => (await navigator.storage?.estimate?.()) ?? {};

/** 4.3 / 60 GB: one decimal under 10, whole numbers above. */
function gigabytes(bytes: number): string {
  const gb = bytes / 1e9;
  return gb >= 10 ? String(Math.round(gb)) : gb.toFixed(1);
}

function StorageFigure({ estimate }: { estimate: Estimate }) {
  const [numbers, setNumbers] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let live = true;
    estimate()
      .then((value) => {
        if (live) setNumbers({ usage: value.usage ?? 0, quota: value.quota ?? 0 });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [estimate]);
  if (!numbers || numbers.quota === 0) return null;
  const used = Math.min(100, (numbers.usage / numbers.quota) * 100);
  return (
    <div className={styles.storage} title="Browser storage this site uses">
      <div className={styles.meter} aria-hidden="true">
        <div style={{ width: `${Math.max(used, 1)}%` }} />
      </div>
      <span>
        {gigabytes(numbers.usage)} / {gigabytes(numbers.quota)} GB
      </span>
    </div>
  );
}

/** The edition's icon, or its short name on a colored tile when the image is missing. */
export function EditionIcon({ game, className }: { game: GameRecord; className?: string }) {
  const brand = EDITION_BRAND[game.id];
  return (
    <BrandImage
      src={appPath(brand.icon)}
      alt=""
      className={className ?? styles.icon}
      fallback={
        <span
          className={styles.tile}
          style={{ background: brand.tile, borderColor: brand.tileBorder }}
        >
          {brand.short}
        </span>
      }
    />
  );
}

/** The launcher frame: a full-width top bar over a game rail; screens fill the area under both. */
export function Shell({
  editions,
  edition,
  onEdition,
  children,
  estimate = browserEstimate,
}: {
  editions: GameRecord[];
  edition: GameRecord | null;
  onEdition(game: GameRecord): void;
  children: ReactNode;
  estimate?: Estimate;
}) {
  const inSettings = useLocation().pathname.startsWith("/settings");
  return (
    <div className={styles.shell}>
      <main className={styles.stage}>{children}</main>

      <nav className={styles.rail} aria-label="Games">
        {editions.map((game) => {
          const brand = EDITION_BRAND[game.id];
          const current = game.id === edition?.id;
          return (
            <button
              key={game.id}
              type="button"
              className={styles.edition}
              aria-label={brand.title}
              aria-current={current ? "true" : undefined}
              onClick={() => onEdition(game)}
            >
              <EditionIcon game={game} />
              <span className={styles.editionName}>{brand.title.toUpperCase()}</span>
            </button>
          );
        })}
        <div className={styles.spacer} />
        <Link
          to="/settings/launcher"
          className={styles.settings}
          aria-label="Settings"
          aria-current={inSettings ? "page" : undefined}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
          </svg>
          <span>SETTINGS</span>
        </Link>
      </nav>

      <header className={styles.bar}>
        <BrandImage
          src={appPath(LOGO_SRC)}
          alt="YuriNet"
          className={styles.logo}
          fallback={<span className={styles.logoText}>YURINET</span>}
        />
        <nav className={styles.tabs} aria-label="Launcher">
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={styles.tab}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <StorageFigure estimate={estimate} />
      </header>
    </div>
  );
}
