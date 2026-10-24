import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import type { Manifest } from "../storage/manifest";
import { fileListSource } from "../storage/importer";
import { importMod, listMods, removeMod, type ModRecord } from "../storage/mods";
import type { CopyTarget } from "../storage/opfs";
import { formatBytes } from "./format";

export function ModLibrary({
  game,
  manifest,
  target,
}: {
  game: string;
  manifest: Manifest;
  target: CopyTarget;
}) {
  const [mods, setMods] = useState<ModRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => setMods(await listMods(manifest, game));
  const report = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const load = async (files: FileList) => {
    setBusy(true);
    try {
      const mod = await importMod(fileListSource(files), game, manifest, target, (done, total) =>
        setMessage(`Copying ${formatBytes(done)} of ${formatBytes(total)}…`),
      );
      await refresh();
      setMessage(`${mod.name} imported. F9 at the main menu switches mods.`);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (open) void refresh().catch(report);
      }}
    >
      <Dialog.Trigger>
        <Button variant="ghost" size="1">
          Mods…
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Mods</Dialog.Title>
        <Dialog.Description mb="4">
          Import a folder of mod data. Press F9 at the game's main menu to switch; the game restarts
          with the next mod.
        </Dialog.Description>
        <Flex direction="column" gap="3">
          {mods.map((mod) => (
            <Flex key={mod.name} justify="between" align="center" gap="2">
              <Text>
                {mod.name} · {formatBytes(mod.bytes)}
              </Text>
              <Button
                disabled={busy}
                variant="soft"
                color="gray"
                onClick={() => {
                  setBusy(true);
                  void removeMod(manifest, target, game, mod)
                    .then(refresh)
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                Remove
              </Button>
            </Flex>
          ))}
          <Text as="label" size="2">
            Import mod folder
            <input
              type="file"
              aria-label="Mod folder"
              disabled={busy}
              // @ts-expect-error folder selection is a browser extension
              webkitdirectory=""
              multiple
              onChange={(event) => {
                if (event.target.files?.length) void load(event.target.files);
                event.target.value = "";
              }}
            />
          </Text>
          {message && (
            <Text role="status" size="2">
              {message}
            </Text>
          )}
          <Flex justify="end">
            <Dialog.Close>
              <Button disabled={busy}>Done</Button>
            </Dialog.Close>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
