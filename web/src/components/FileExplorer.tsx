import { AlertDialog, Button, Callout, Dialog, Flex, Heading, Text } from "@radix-ui/themes";
import { UploadIcon } from "@radix-ui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { ReadOnlyFileSource, UploadReport } from "../storage/file-browser";
import {
  loadFileExplorer,
  type ExplorerEntry,
  type ExplorerFolder,
  type ExplorerInstance,
} from "./file-explorer-assets";
import styles from "./FileExplorer.module.css";

function pathIn(folder: ExplorerFolder): string {
  return folder.GetPathIDs().slice(1).join("/");
}

function widgetEntries(
  entries: Awaited<ReturnType<ReadOnlyFileSource["list"]>>,
  managed: boolean,
): ExplorerEntry[] {
  return entries.map((entry) => ({
    id: entry.name,
    name: entry.name,
    type: entry.type,
    hash: `${entry.type}:${entry.size ?? ""}:${entry.modified ?? ""}`,
    // a folder the game keeps can be worked in, just not deleted itself
    attrs: { canmodify: managed, ...(entry.locked ? { locked: true } : {}) },
    ...(entry.size === undefined ? {} : { size: entry.size }),
    tooltip:
      entry.type === "folder"
        ? entry.locked
          ? "Kept by the game; delete what is inside it"
          : managed
            ? "Folder"
            : "Read-only folder"
        : "Double-click to open text files",
  }));
}

function failure(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function summary(report: UploadReport): string {
  const parts: string[] = [];
  if (report.added.length) parts.push(`Added ${report.added.join(", ")}.`);
  if (report.replaced.length) parts.push(`Replaced ${report.replaced.join(", ")}.`);
  return [...parts, ...report.notes].join(" ");
}

interface PendingUpload {
  folder: string;
  files: File[];
  clashes: string[];
}

interface PendingDelete {
  paths: string[];
  warning: string;
  done(result: true | string): void;
}

/**
 * js-fileexplorer over a source. It is read-only unless the source can be managed, and then the player
 * can upload files (here, not through the widget's own uploader) and delete them. Nothing can be
 * downloaded or exported.
 */
export function FileExplorer({ source, onClose }: { source: ReadOnlyFileSource; onClose(): void }) {
  const host = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const explorer = useRef<ExplorerInstance | null>(null);
  const deleteConfirmed = useRef(false);
  const [instance, setInstance] = useState<ExplorerInstance | null>(null);
  // what an upload, delete or open went wrong with; a refresh of the listing must not wipe it
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<{ path: string; text: string } | null>(null);
  const [replacing, setReplacing] = useState<PendingUpload | null>(null);
  const [deleting, setDeleting] = useState<PendingDelete | null>(null);
  const manage = source.manage;
  const managed = !!manage;

  useEffect(() => {
    let cancelled = false;
    let created: ExplorerInstance | null = null;
    void loadFileExplorer().then(
      (FileExplorerWidget) => {
        if (cancelled || !host.current) return;
        try {
          created = new FileExplorerWidget(host.current, {
            initpath: [["root", source.rootLabel, { canmodify: managed }]],
            tools: {
              new_folder: false,
              new_file: false,
              upload: false,
              download: false,
              copy: false,
              paste: false,
              cut: false,
              delete: managed,
              item_checkboxes: false,
            },
            onrefresh(folder) {
              setListError(null);
              void source.list(pathIn(folder)).then(
                (entries) => {
                  if (
                    !cancelled &&
                    created &&
                    !created.IsDestroyed() &&
                    created.IsMappedFolder(folder)
                  )
                    folder.SetEntries(widgetEntries(entries, managed));
                },
                (reason: unknown) => {
                  if (cancelled) return;
                  setListError(failure(reason));
                  if (created && !created.IsDestroyed() && created.IsMappedFolder(folder))
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
                  if (!cancelled) setError(failure(reason));
                },
              );
            },
            ...(manage
              ? {
                  ondelete(
                    done: (result: true | string) => void,
                    folder: ExplorerFolder,
                    ids: string[],
                    entries: ExplorerEntry[],
                  ) {
                    if (entries.some((entry) => entry.attrs.locked)) {
                      done("That folder is kept by the game; delete the files inside it.");
                      return;
                    }
                    const paths = ids.map((id) => [pathIn(folder), id].filter(Boolean).join("/"));
                    setDeleting({ paths, warning: manage.removeWarning(paths) ?? "", done });
                  },
                }
              : {}),
          });
          if (cancelled) created.Destroy();
          else {
            explorer.current = created;
            setInstance(created);
          }
        } catch (reason) {
          setError(failure(reason));
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(failure(reason));
      },
    );
    return () => {
      cancelled = true;
      explorer.current = null;
      created?.Destroy();
    };
  }, [source, manage, managed]);

  const refresh = () => explorer.current?.RefreshFolders?.(true);

  async function upload(folder: string, files: File[]) {
    if (!manage) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await manage.upload(folder, files);
      setNotice(summary(report) || null);
      setError(report.problems.length ? report.problems.join("\n") : null);
    } catch (reason) {
      setError(failure(reason));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function chosen(files: File[]) {
    if (!manage || !files.length) return;
    const current = explorer.current?.GetCurrentFolder?.();
    const folder = current ? pathIn(current) : "";
    try {
      const clashes = await manage.clashes(
        folder,
        files.map((file) => file.name),
      );
      if (clashes.length) setReplacing({ folder, files, clashes });
      else await upload(folder, files);
    } catch (reason) {
      setError(failure(reason));
    }
  }

  async function confirmDelete(pending: PendingDelete) {
    if (!manage) return;
    // the dialog closing is not a "no" from here on
    deleteConfirmed.current = true;
    setDeleting(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const notes = await manage.remove(pending.paths);
      setNotice(notes.join(" ") || null);
      pending.done(true);
    } catch (reason) {
      pending.done(failure(reason));
      setError(failure(reason));
    } finally {
      setBusy(false);
    }
  }

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
              {managed
                ? "Double-click text files to view them. Upload adds files or replaces ones with the same name; select files and press Delete to remove them. This changes only this browser's copy of the game. Game files cannot be downloaded."
                : "Read-only. Double-click text files to view them. Game data cannot be changed or downloaded here."}
            </Dialog.Description>
          </div>
          <Dialog.Close>
            <Button variant="soft">Close</Button>
          </Dialog.Close>
        </Flex>
        {managed && !opened && (
          <Flex gap="3" align="center" mb="2">
            <Button
              variant="soft"
              disabled={busy || !instance}
              onClick={() => picker.current?.click()}
            >
              <UploadIcon />
              Upload files…
            </Button>
            <input
              ref={picker}
              type="file"
              multiple
              className={styles.hidden}
              aria-label="Files to upload"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                void chosen(files);
              }}
            />
            {busy && (
              <Text size="2" color="gray" role="status">
                Working…
              </Text>
            )}
          </Flex>
        )}
        {notice && !error && !listError && (
          <Text size="2" color="green" role="status" mb="2" className={styles.message}>
            {notice}
          </Text>
        )}
        {(error ?? listError) && (
          <Callout.Root color="amber" role="status" mb="2">
            <Callout.Text className={styles.message}>{error ?? listError}</Callout.Text>
          </Callout.Root>
        )}
        {opened && (
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
        )}
        {/* Stays mounted while a file is open: the widget was built on this node, and a fresh one would be empty. */}
        <div
          ref={host}
          hidden={!!opened}
          className={styles.explorer}
          data-testid="read-only-file-explorer"
        />
        {instance && !managed && (
          <Text className={styles.readOnlyNote} size="1" color="gray">
            Browsing is read-only.
          </Text>
        )}
      </Dialog.Content>
      <AlertDialog.Root
        open={!!replacing}
        onOpenChange={(open) => {
          if (!open) setReplacing(null);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            Replace {replacing?.clashes.length === 1 ? "file" : "files"}?
          </AlertDialog.Title>
          <AlertDialog.Description size="2" className={styles.message}>
            {replacing?.clashes.join(", ")} {replacing?.clashes.length === 1 ? "is" : "are"} already
            here and will be replaced.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Keep the old {replacing?.clashes.length === 1 ? "one" : "ones"}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                onClick={() => {
                  const pending = replacing;
                  setReplacing(null);
                  if (pending) void upload(pending.folder, pending.files);
                }}
              >
                Replace
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={!!deleting}
        onOpenChange={(open) => {
          if (open) return;
          if (deleting && !deleteConfirmed.current) deleting.done("Cancelled.");
          deleteConfirmed.current = false;
          setDeleting(null);
        }}
      >
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            Delete{" "}
            {deleting?.paths.length === 1
              ? deleting.paths[0]
              : `${deleting?.paths.length ?? 0} items`}
            ?
          </AlertDialog.Title>
          <AlertDialog.Description size="2" className={styles.message}>
            {deleting?.warning}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Keep it
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => deleting && void confirmDelete(deleting)}>
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Dialog.Root>
  );
}
