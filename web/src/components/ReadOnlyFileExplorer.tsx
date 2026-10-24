import { Button, Callout, Dialog, Flex, Heading, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import type { ReadOnlyFileSource } from "../storage/file-browser";
import {
  loadFileExplorer,
  type ExplorerEntry,
  type ExplorerFolder,
  type ExplorerInstance,
} from "./file-explorer-assets";
import styles from "./ReadOnlyFileExplorer.module.css";

function pathIn(folder: ExplorerFolder): string {
  return folder.GetPathIDs().slice(1).join("/");
}

function widgetEntries(entries: Awaited<ReturnType<ReadOnlyFileSource["list"]>>): ExplorerEntry[] {
  return entries.map((entry) => ({
    id: entry.name,
    name: entry.name,
    type: entry.type,
    hash: `${entry.type}:${entry.size ?? ""}:${entry.modified ?? ""}`,
    attrs: { canmodify: false },
    ...(entry.size === undefined ? {} : { size: entry.size }),
    tooltip: entry.type === "folder" ? "Read-only folder" : "Double-click to open text files",
  }));
}

/** js-fileexplorer is configured without any write, upload, or download capability. */
export function ReadOnlyFileExplorer({
  source,
  onClose,
}: {
  source: ReadOnlyFileSource;
  onClose(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<ExplorerInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ path: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let explorer: ExplorerInstance | null = null;
    void loadFileExplorer().then(
      (FileExplorer) => {
        if (cancelled || !host.current) return;
        try {
          explorer = new FileExplorer(host.current, {
            initpath: [["root", source.rootLabel, { canmodify: false }]],
            tools: {
              new_folder: false,
              new_file: false,
              upload: false,
              download: false,
              copy: false,
              paste: false,
              cut: false,
              delete: false,
              item_checkboxes: false,
            },
            onrefresh(folder) {
              setError(null);
              void source.list(pathIn(folder)).then(
                (entries) => {
                  if (
                    !cancelled &&
                    explorer &&
                    !explorer.IsDestroyed() &&
                    explorer.IsMappedFolder(folder)
                  )
                    folder.SetEntries(widgetEntries(entries));
                },
                (reason: unknown) => {
                  if (cancelled) return;
                  setError(reason instanceof Error ? reason.message : String(reason));
                  if (explorer && !explorer.IsDestroyed() && explorer.IsMappedFolder(folder))
                    folder.SetEntries([]);
                },
              );
            },
            onopenfile(folder, entry) {
              const path = [pathIn(folder), entry.id].filter(Boolean).join("/");
              setError(null);
              void source.readText(path).then(
                (text) => {
                  if (!cancelled) setOpened({ path, text });
                },
                (reason: unknown) => {
                  if (!cancelled)
                    setError(reason instanceof Error ? reason.message : String(reason));
                },
              );
            },
          });
          if (cancelled) explorer.Destroy();
          else setInstance(explorer);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      cancelled = true;
      explorer?.Destroy();
    };
  }, [source]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        className={styles.dialog}
        maxWidth="1000px"
        aria-describedby="file-browser-description"
      >
        <Flex align="start" justify="between" gap="3">
          <div>
            <Dialog.Title>{source.label}</Dialog.Title>
            <Dialog.Description id="file-browser-description" mb="3">
              Read-only. Double-click text files to view them. Game data cannot be changed or
              downloaded here.
            </Dialog.Description>
          </div>
          <Dialog.Close>
            <Button variant="soft">Close</Button>
          </Dialog.Close>
        </Flex>
        {error && (
          <Callout.Root color="amber" role="status" mb="2">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {opened ? (
          <section className={styles.reader} aria-label={`Text file ${opened.path}`}>
            <Flex align="center" justify="between" gap="3" mb="2">
              <Heading size="3" className={styles.filename}>
                {opened.path}
              </Heading>
              <Button variant="soft" onClick={() => setOpened(null)}>
                Back to files
              </Button>
            </Flex>
            <pre className={styles.text} tabIndex={0} aria-label="File contents">
              {opened.text}
            </pre>
          </section>
        ) : (
          <div ref={host} className={styles.explorer} data-testid="read-only-file-explorer" />
        )}
        {instance && (
          <Text className={styles.readOnlyNote} size="1" color="gray">
            Browsing is read-only.
          </Text>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
