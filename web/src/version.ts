// The launcher's version, read from web/package.json as a module import: a running dev server serves it
// like any other file, with no config to reload (web/CHANGELOG.md has the notes for each version).
import { version } from "../package.json";

export const APP_VERSION: string = version;
