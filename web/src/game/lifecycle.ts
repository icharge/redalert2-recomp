import { appPath } from "../paths";
import type { GameHandle } from "./loader";

/** A document navigation ends Emscripten's workers and releases references to its memory. */
export async function leaveGame(
  session: Promise<GameHandle> | undefined,
  destination = appPath(),
  navigate: (url: string) => void = (url) => window.location.replace(url),
  flush = true,
): Promise<void> {
  // A failed startup has no live handle or save sync to finish.
  const game = await session?.catch(() => null);
  game?.saves?.stop();
  if (flush) await game?.saves?.flush();
  sessionStorage.removeItem("ra2-resume-game");
  navigate(destination);
}
