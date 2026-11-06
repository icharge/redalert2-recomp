import type { ActiveInstall } from "../../storage/active-install";
import {
  assessEditionReadiness,
  type BuildInfo,
  type EditionReadiness,
} from "../../storage/install";
import type { GameRecord } from "../../storage/manifest";

/** What the edition's copied files allow, judged against the build; null when the build is unknown. */
export function editionReadiness(
  game: GameRecord,
  build: BuildInfo | undefined,
): EditionReadiness | null {
  if (!build) return null;
  return assessEditionReadiness(
    game.id,
    build,
    Object.entries(game.files)
      .filter(([, entry]) => entry.done)
      // a movie archive the player left out is a 12-byte stub
      .filter(([name, entry]) => !/^(?:movies|movmd)[^/]*\.mix$/i.test(name) || entry.size > 12)
      .map(([name]) => name),
  );
}

export interface PlayStatus {
  canPlay: boolean;
  ready: boolean;
  text: string;
}

export function playStatus(game: GameRecord, build: BuildInfo | undefined): PlayStatus {
  if (!game.complete) return { canPlay: false, ready: false, text: "Install not finished" };
  const readiness = editionReadiness(game, build);
  if (!readiness || readiness.status === "ready")
    return { canPlay: true, ready: true, text: "Ready" };
  if (readiness.status === "runtime-not-built")
    return { canPlay: false, ready: false, text: "Runtime not built for this edition" };
  return { canPlay: false, ready: false, text: `Missing ${readiness.missing.join(", ")}` };
}

/** The import stopped before every edition it meant to copy was complete. */
export function needsResume(install: ActiveInstall): boolean {
  const { installation, editions } = install;
  return (
    editions.length === 0 ||
    editions.some((game) => !game.complete) ||
    !!installation.editions?.some((id) => !editions.some((game) => game.id === id && game.complete))
  );
}
