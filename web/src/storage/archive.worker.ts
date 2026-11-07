// The archive import's worker: 7-Zip reads the picked file where it is (WORKERFS), so a 3 GB
// archive is never held in memory. archive-host.ts does the work; archive.ts is the page's side.

import SevenZipFactory from "7z-wasm";
import wasmUrl from "7z-wasm/7zz.wasm?url";
import { archiveHost, type FromArchiveHost, type ToArchiveHost } from "./archive-host";
import { openSevenZip } from "./sevenzip";

const scope = self as unknown as {
  postMessage(message: FromArchiveHost, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToArchiveHost>) => void) | null;
};

const receive = archiveHost(
  async (file) => {
    const zip = await openSevenZip(SevenZipFactory, {
      locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
    });
    const { FS, WORKERFS } = zip.module;
    FS.mkdir("/in");
    FS.mount(WORKERFS, { files: [file] }, "/in");
    return { zip, path: `/in/${file.name}` };
  },
  (message) => scope.postMessage(message, message.type === "chunk" ? [message.chunk.buffer] : []),
);

// one message at a time: a pass runs to its end before the next is read
let queue = Promise.resolve();
scope.onmessage = (event) => {
  queue = queue.then(() => receive(event.data));
};
