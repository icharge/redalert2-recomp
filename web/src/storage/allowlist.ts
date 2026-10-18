// What of a game folder the browser build keeps (docs/web/storage.md): the import's own rule
// (install.ts), also used by the dev server, which serves only this, so a run from the local folder
// has the files an import would have given it. Matched without regard to case, at the folder's top level.
import { classify } from "./install";

export function isAllowlisted(fileName: string): boolean {
  return classify(fileName) !== null;
}
