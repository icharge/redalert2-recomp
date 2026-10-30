// What this browser must have for the game (docs/web/frontend.md, the Browser check screen).

export interface Requirement {
  id: "threads" | "storage";
  label: string;
  ok: boolean;
  /** without it the game cannot start; otherwise it is a feature the player loses */
  required: boolean;
  /** what is missing, and what to do */
  help: string;
}

/** The parts of the global scope the checks look at, so a test can give others. */
export interface BrowserEnv {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
  navigator?: { storage?: { getDirectory?: unknown } };
}

export function checkBrowser(env: BrowserEnv = globalThis as unknown as BrowserEnv): Requirement[] {
  const threads = env.crossOriginIsolated === true && typeof env.SharedArrayBuffer !== "undefined";
  const storage = typeof env.navigator?.storage?.getDirectory === "function";
  return [
    {
      id: "threads",
      label: "Threads (SharedArrayBuffer)",
      ok: threads,
      required: true,
      help:
        "The game runs on its own thread, which needs a page the browser treats as cross-origin isolated. " +
        "A host that sends no headers gets them from the page's service worker, which reloads the page once; " +
        "reload if this screen stays. Serve the site over HTTPS (or localhost), not from a file, and use a " +
        "current Chrome, Edge, Firefox or Safari.",
    },
    {
      id: "storage",
      label: "Private file storage (OPFS)",
      ok: storage,
      required: false,
      help: "Importing your game folder needs the browser's private file system. Current Chrome, Edge, Firefox and Safari have it.",
    },
  ];
}

export function missingRequired(requirements: Requirement[]): Requirement[] {
  return requirements.filter((r) => r.required && !r.ok);
}
