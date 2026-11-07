// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import SevenZipFactory from "7z-wasm";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { archiveHost, type FromArchiveHost, type ToArchiveHost } from "./archive-host";
import { archiveSource, isArchiveName, type ArchiveWorker } from "./archive";
import { prepareImport, runImport } from "./importer";
import type { BuildInfo } from "./install";
import { Manifest } from "./manifest";
import { listMods } from "./mods";
import type { CopyTarget } from "./opfs";
import { openSevenZip } from "./sevenzip";

const wasmBinary = readFileSync(createRequire(import.meta.url).resolve("7z-wasm/7zz.wasm"));
const load = () => openSevenZip(SevenZipFactory, { wasmBinary: wasmBinary.buffer as ArrayBuffer });

const bytes = (size: number, seed: number) => {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * seed + (i >> 8)) & 255;
  return data;
};

/** A real archive of these files, made by 7-Zip, as the File the player would pick. */
async function archiveFile(files: Record<string, Uint8Array | string>, name = "RA2.7z") {
  const zip = await load();
  const { FS } = zip.module;
  for (const [path, data] of Object.entries(files)) {
    let dir = "";
    for (const part of `src/${path}`.split("/").slice(0, -1)) {
      dir += `/${part}`;
      try {
        FS.mkdir(dir);
      } catch {
        // there already
      }
    }
    FS.writeFile(`/src/${path}`, data);
  }
  FS.chdir("/src");
  const type = name.endsWith(".zip") ? "zip" : "7z";
  zip.module.callMain(["a", `-t${type}`, "-bsp0", "-bso0", "/out", ...FS.readdir("/src").slice(2)]);
  return new File([FS.readFile(`/out.${type}`) as Uint8Array<ArrayBuffer>], name);
}

/** The worker, run in this thread: the archive is copied into the module's memory, not mounted. */
function inProcess(): () => ArchiveWorker {
  return () => {
    const worker: ArchiveWorker = {
      onmessage: null,
      postMessage(message: ToArchiveHost) {
        void receive(message);
      },
      terminate() {},
    };
    const receive = archiveHost(
      async (file) => {
        const zip = await load();
        zip.module.FS.writeFile("/in.bin", new Uint8Array(await file.arrayBuffer()));
        return { zip, path: "/in.bin" };
      },
      (message: FromArchiveHost) =>
        setTimeout(() => worker.onmessage?.({ data: message } as MessageEvent<FromArchiveHost>)),
    );
    return worker;
  };
}

function memoryTarget(): CopyTarget & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async write(path, stream) {
      const parts: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let at = 0;
      for (const part of parts) {
        all.set(part, at);
        at += part.length;
      }
      files.set(path, all);
    },
    async size(path) {
      return files.get(path)?.length ?? null;
    },
    async remove(path) {
      files.delete(path);
    },
  };
}

const build: BuildInfo = {
  games: { ra2md: { title: "Yuri's Revenge", exe: "gamemd.exe", ini: "RA2MD.INI", stamp: 1 } },
};
const roomy = { quota: 1e12, usage: 0 };
const options = { movies: true, saves: true, settings: false };

const game = {
  "Westwood/RA2/ra2.mix": bytes(40_000, 3),
  "Westwood/RA2/ra2md.mix": bytes(30_000, 5),
  "Westwood/RA2/maps01.mix": bytes(20_000, 7),
  "Westwood/RA2/multi.mix": bytes(10_000, 11),
  "Westwood/RA2/gamemd.exe": bytes(500, 13),
  "Westwood/RA2/Tour of Egypt.map": "[Map]",
  "Westwood/RA2/Mods/Lite/rulesmd.ini": "[General]",
  "Westwood/RA2/Mods/Lite/expandmd90.mix": bytes(9_000, 17),
  "Westwood/readme.txt": "hello",
};

describe("isArchiveName", () => {
  it("takes 7z, zip, rar and exe, in any case", () => {
    for (const name of ["a.7z", "A.ZIP", "b.rar", "Setup.EXE"])
      expect(isArchiveName(name)).toBe(true);
    for (const name of ["a.mix", "a.7z.txt", "zip"]) expect(isArchiveName(name)).toBe(false);
  });
});

describe("archiveSource", () => {
  it("lists the game folder inside the archive, wherever ra2.mix is", async () => {
    const source = archiveSource(await archiveFile(game), { spawn: inProcess() });
    expect(source.name).toBe("RA2.7z");
    const files = await source.list();
    expect(files.map((file) => file.path).sort()).toEqual([
      "Mods/Lite/expandmd90.mix",
      "Mods/Lite/rulesmd.ini",
      "Tour of Egypt.map",
      "gamemd.exe",
      "maps01.mix",
      "multi.mix",
      "ra2.mix",
      "ra2md.mix",
    ]);
    source.close();
  });

  it("installs from the archive: the game, the map and the mod, each byte for byte", async () => {
    const source = archiveSource(await archiveFile(game), { spawn: inProcess() });
    const manifest = await Manifest.open(new IDBFactory());
    const target = memoryTarget();
    const prepared = await prepareImport(source, build, options, roomy);
    expect(prepared.plan.mods.map((mod) => mod.name)).toEqual(["Lite"]);
    await runImport({ prepared, build, manifest, target });
    for (const name of ["ra2.mix", "ra2md.mix", "maps01.mix", "multi.mix"])
      expect(target.files.get(`game/slot-1/${name}`), name).toEqual(
        game[`Westwood/RA2/${name}` as keyof typeof game],
      );
    expect(new TextDecoder().decode(target.files.get("game/slot-1/Tour of Egypt.map"))).toBe(
      "[Map]",
    );
    const [yuri] = await manifest.listGames();
    expect((await listMods(manifest, yuri!.storage)).map((mod) => mod.name)).toEqual(["Lite"]);
    expect(target.files.get(`game/${yuri!.storage}/mods/Lite/expandmd90.mix`)).toEqual(
      game["Westwood/RA2/Mods/Lite/expandmd90.mix"],
    );
    expect((await manifest.getGame("ra2md"))?.complete).toBe(true);
    source.close();
  });

  it("reads a zip too", async () => {
    const source = archiveSource(await archiveFile(game, "RA2.zip"), { spawn: inProcess() });
    const prepared = await prepareImport(source, build, options, roomy);
    const target = memoryTarget();
    await runImport({ prepared, build, manifest: await Manifest.open(new IDBFactory()), target });
    expect(target.files.get("game/slot-1/ra2.mix")).toEqual(game["Westwood/RA2/ra2.mix"]);
    source.close();
  });

  it("says when 7-Zip cannot open the file", async () => {
    const source = archiveSource(new File([bytes(3000, 1)], "Setup.exe"), { spawn: inProcess() });
    await expect(source.list()).rejects.toThrow(/cannot open .*Setup\.exe.*installed folder/is);
    source.close();
  });
});
