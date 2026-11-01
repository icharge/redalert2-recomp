// Apply the launcher's static strings.json overrides to the table the game will
// read.
//
// This runs after the game's files are in the in-memory /game folder and before
// the save watcher starts, so the generated table is not copied to OPFS. The
// game reads the loose CSF instead of the copy inside its language MIX.

import { parseCsf, rewriteCsf } from "../storage/csf";
import { csfName, findBaseCsf, type CsfSourceFs } from "../storage/csf-source";
import type { GameId } from "../storage/install";
import {
  editionStrings,
  launcherExtras,
  readLauncherStrings,
  type LauncherStringsConfig,
} from "../storage/launcher-strings";

export interface CsfApplyFs extends CsfSourceFs {
  writeFile(path: string, data: Uint8Array): void;
}

export interface CsfApplyOptions {
  /** Thai bytes need the Thai font fix; warn, but do not block, when it is off. */
  thaiFontFixEnabled?: boolean;
  /** Tests and hosts that already hold strings.json. */
  readStrings?: () => Promise<LauncherStringsConfig>;
}

export interface CsfApplyResult {
  applied: boolean;
  /** the path the generated table was written to */
  path: string | null;
  source: "mod" | "loose" | "mix" | null;
  /** labels the file asked to change but the base table does not have */
  missing: string[];
  injected: string[];
  /** a non-fatal explanation to show the player */
  warning: string | null;
}

const skipped = (warning: string | null = null): CsfApplyResult => ({
  applied: false,
  path: null,
  source: null,
  missing: [],
  injected: [],
  warning,
});

/** Apply the static overrides, if any. Failures leave the game files untouched. */
export async function applyCsfOverrides(
  fs: CsfApplyFs,
  game: GameId,
  options: CsfApplyOptions = {},
): Promise<CsfApplyResult> {
  let config: LauncherStringsConfig;
  try {
    config = await (options.readStrings ?? readLauncherStrings)();
  } catch (error) {
    return skipped(
      `The launcher's strings.json could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const csf = editionStrings(config, game);
  if (!csf || !csf.enabled) return skipped();
  if (Object.keys(csf.strings).length === 0) return skipped();

  const base = await findBaseCsf(fs, game);
  if (!base)
    return skipped(
      "The launcher's strings.json changes strings, but no CSF was found. Add a loose ra2.csf/ra2md.csf or a language MIX.",
    );

  try {
    const parsed = parseCsf(base.data, csf.encoding);
    const result = rewriteCsf(parsed, {
      strings: csf.strings,
      inject: csf.inject,
      encoding: csf.encoding,
      extra: launcherExtras(csf),
    });
    const path =
      base.source === "mod" || base.source === "loose" ? base.path : `/game/${csfName(game)}`;
    fs.writeFile(path, result.data);

    const warnings: string[] = [];
    if (result.missing.length)
      warnings.push(
        `${result.missing.length} string label${
          result.missing.length === 1 ? " is" : "s are"
        } not in this table and ${result.missing.length === 1 ? "was" : "were"} left unchanged.`,
      );
    if (csf.encoding === "windows-874" && !options.thaiFontFixEnabled)
      warnings.push(
        "Thai strings were written with windows-874, but the Thai font fix is off; the text may not display correctly.",
      );
    return {
      applied: true,
      path,
      source: base.source,
      missing: result.missing,
      injected: result.injected,
      warning: warnings.length ? warnings.join(" ") : null,
    };
  } catch (error) {
    return skipped(
      `The launcher's strings.json overrides were not applied: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
