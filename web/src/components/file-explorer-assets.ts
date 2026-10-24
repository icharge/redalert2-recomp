import { appPath } from "../paths";

export interface ExplorerEntry {
  id: string;
  name: string;
  type: "folder" | "file";
  hash: string;
  /** `canmodify` is about what is inside a folder; `locked` is about the entry itself */
  attrs: { canmodify: boolean; locked?: boolean };
  size?: number;
  tooltip?: string;
}

export interface ExplorerFolder {
  GetPathIDs(): string[];
  SetEntries(entries: ExplorerEntry[]): void;
}

export interface ExplorerOptions {
  initpath: [string, string, { canmodify: boolean }][];
  /** Only `delete` is ever switched on, and only for a source that can be managed; there is no upload or download. */
  tools: {
    new_folder: false;
    new_file: false;
    upload: false;
    download: false;
    copy: false;
    paste: false;
    cut: false;
    delete: boolean;
    item_checkboxes: false;
  };
  onrefresh(folder: ExplorerFolder, required: boolean): void;
  onopenfile(folder: ExplorerFolder, entry: ExplorerEntry): void;
  /** Present only for a source that can be managed. Call `done(true)`, or `done(reason)` to say why not. */
  ondelete?(
    done: (result: true | string) => void,
    folder: ExplorerFolder,
    ids: string[],
    entries: ExplorerEntry[],
  ): void;
}

export interface ExplorerInstance {
  Destroy(): void;
  IsDestroyed(): boolean;
  IsMappedFolder(folder: ExplorerFolder): boolean;
  GetCurrentFolder?(): ExplorerFolder | false;
  RefreshFolders?(forceCurrent?: boolean): void;
}

export interface ExplorerConstructor {
  new (parent: HTMLElement, options: ExplorerOptions): ExplorerInstance;
}

declare global {
  interface Window {
    FileExplorer?: ExplorerConstructor;
  }
}

let loaded: Promise<ExplorerConstructor> | undefined;

function stylesheet(): Promise<void> {
  const existing = document.querySelector<HTMLLinkElement>("link[data-js-fileexplorer]");
  if (existing?.sheet) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = existing ?? document.createElement("link");
    link.rel = "stylesheet";
    link.href = appPath("vendor/js-fileexplorer/file-explorer.css");
    link.dataset.jsFileexplorer = "true";
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Could not load the file browser styles."));
    if (!existing) document.head.append(link);
  });
}

function script(): Promise<ExplorerConstructor> {
  if (window.FileExplorer) return Promise.resolve(window.FileExplorer);
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = appPath("vendor/js-fileexplorer/file-explorer.js");
    element.async = true;
    element.onload = () => {
      if (window.FileExplorer) resolve(window.FileExplorer);
      else reject(new Error("The file browser loaded without its FileExplorer API."));
    };
    element.onerror = () => reject(new Error("Could not load the file browser."));
    document.head.append(element);
  });
}

/** Loads the pinned, locally vendored js-fileexplorer assets on first use. */
export function loadFileExplorer(): Promise<ExplorerConstructor> {
  loaded ??= Promise.all([stylesheet(), script()]).then(([, constructor]) => constructor);
  return loaded;
}
