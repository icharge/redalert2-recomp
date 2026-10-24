import {
  AlertDialog,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  IconButton,
  Link,
  TextField,
  Text,
} from "@radix-ui/themes";
import {
  CheckIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  GearIcon,
  Pencil1Icon,
  PlayIcon,
  Cross2Icon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { formatBytes } from "../components/format";
import { LauncherGameSettings } from "../components/LauncherGameSettings";
import { ReadOnlyFileExplorer } from "../components/ReadOnlyFileExplorer";
import { StorageMeter } from "../components/StorageMeter";
import { importedFileSource } from "../storage/file-browser";
import type { GameRecord, InstallationRecord } from "../storage/manifest";
import styles from "./Library.module.css";

export interface LibraryProps {
  games: GameRecord[];
  installations?: InstallationRecord[];
  onResume?(slot: number): void;
  onPlay(game: GameRecord): void;
  /** the Import screen, for another game or to finish one */
  onImport(): void;
  onRenameInstallation?(installation: InstallationRecord, displayName: string): Promise<void>;
  /** forget the game and delete what only it reads; resolves when done */
  onRemove(installation: InstallationRecord): Promise<void>;
  /** hands the player a zip of the game's saved games; says what happened ("No saved games yet") */
  onDownloadSaves(game: GameRecord): Promise<string>;
  /** takes saved games from a zip the player chose; says what happened */
  onImportSaves(game: GameRecord, zip: File): Promise<string>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  modManager?(game: GameRecord): ReactNode;
}

export function Library({
  games,
  installations,
  onResume,
  onPlay,
  onImport,
  onRenameInstallation,
  onRemove,
  onDownloadSaves,
  onImportSaves,
  estimate,
  modManager,
}: LibraryProps) {
  const [removed, setRemoved] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<GameRecord | null>(null);
  const [settingsGame, setSettingsGame] = useState<GameRecord | null>(null);
  const [editingSlot, setEditingSlot] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [localNames, setLocalNames] = useState<Record<number, string>>({});
  const importedSource = useMemo(
    () => (browsing ? importedFileSource(browsing) : null),
    [browsing],
  );

  async function say(work: Promise<string>) {
    try {
      setNotice(await work);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove(game: InstallationRecord) {
    try {
      await onRemove(game);
      setRemoved((n) => n + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  const groups: InstallationRecord[] =
    installations ??
    [...new Set(games.map((game) => game.slot))].map((slot) => ({
      slot,
      name: games.find((game) => game.slot === slot)!.title,
      importedAt: 0,
    }));

  return (
    <Flex className={styles.page} align="center" justify="center" p="4">
      <Flex direction="column" gap="4" className={styles.column}>
        <Heading size="6">Your games</Heading>
        {notice && !failure && (
          <Text size="2" color="green" role="status">
            {notice}
          </Text>
        )}
        {failure && (
          <Callout.Root color="red" role="alert">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{failure}</Callout.Text>
          </Callout.Root>
        )}
        {groups.map((installation) => {
          const choices = games.filter((game) => game.slot === installation.slot);
          const displayName =
            localNames[installation.slot] ??
            installation.displayName ??
            choices[0]?.title ??
            installation.name;
          const saveName = async (event?: FormEvent<HTMLFormElement>) => {
            event?.preventDefault();
            const name = nameDraft.trim();
            if (!name) {
              setFailure("Enter a name for this installation.");
              return;
            }
            try {
              if (onRenameInstallation) await onRenameInstallation(installation, name);
              setLocalNames((names) => ({ ...names, [installation.slot]: name }));
              setFailure(null);
              setEditingSlot(null);
            } catch (error) {
              setFailure(error instanceof Error ? error.message : String(error));
            }
          };
          return (
            <Card
              key={installation.slot}
              className={styles.gameCard}
              size="3"
              data-slot-id={installation.slot}
            >
              <Flex direction="column" gap="4">
                <Flex align="center" gap="2" className={styles.nameRow}>
                  <Text size="1" color="gray" className={styles.slotBadge}>
                    Slot {installation.slot}
                  </Text>
                  {editingSlot === installation.slot ? (
                    <form className={styles.nameForm} onSubmit={(event) => void saveName(event)}>
                      <TextField.Root
                        size="2"
                        autoFocus
                        aria-label="Installation name"
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditingSlot(null);
                        }}
                      />
                      <IconButton
                        type="submit"
                        size="1"
                        variant="soft"
                        color="green"
                        aria-label="Confirm name"
                        title="Save name"
                      >
                        <CheckIcon />
                      </IconButton>
                      <IconButton
                        type="button"
                        size="1"
                        variant="soft"
                        color="gray"
                        aria-label="Cancel name edit"
                        title="Cancel"
                        onClick={() => setEditingSlot(null)}
                      >
                        <Cross2Icon />
                      </IconButton>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={styles.nameButton}
                      aria-label={`Rename ${displayName}`}
                      title="Click to rename"
                      onClick={() => {
                        setNameDraft(displayName);
                        setEditingSlot(installation.slot);
                      }}
                    >
                      <Heading size="5">{displayName}</Heading>
                      <Pencil1Icon className={styles.editIcon} aria-hidden="true" />
                    </button>
                  )}
                </Flex>
                {choices.map((game) => (
                  <div key={game.id} data-game-id={game.id}>
                    <Flex justify="between" align="center" gap="4" wrap="wrap">
                      <Flex direction="column" gap="1">
                        {(choices.length > 1 || displayName !== game.title) && (
                          <Heading size="4">{game.title}</Heading>
                        )}
                        <Text size="2" color="gray">
                          {formatBytes(game.bytes)} · {Object.keys(game.files).length} files ·
                          imported {new Date(game.importedAt).toLocaleDateString()}
                        </Text>
                        <Flex gap="3" mt="1">
                          {modManager?.(game)}
                          <Link
                            href="#"
                            size="2"
                            onClick={(event) => {
                              event.preventDefault();
                              void say(onDownloadSaves(game));
                            }}
                          >
                            Download saves
                          </Link>
                          <Link
                            href="#"
                            size="2"
                            onClick={(event) => {
                              event.preventDefault();
                              document.getElementById(`saves-${game.slot}-${game.id}`)?.click();
                            }}
                          >
                            Import saves…
                          </Link>
                          <input
                            id={`saves-${game.slot}-${game.id}`}
                            type="file"
                            accept=".zip,application/zip"
                            className={styles.hidden}
                            aria-label={`Saves for ${game.title}`}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) void say(onImportSaves(game, file));
                            }}
                          />
                        </Flex>
                        {!game.complete && (
                          <Text size="2" color="amber">
                            The import did not finish. Resume this installation to carry on.
                          </Text>
                        )}
                      </Flex>
                      <Flex className={styles.actions} gap="2" align="center">
                        <IconButton
                          variant="soft"
                          color="gray"
                          aria-label={`Browse files for ${game.title}`}
                          title="Browse files"
                          onClick={() => setBrowsing(game)}
                        >
                          <FileTextIcon />
                        </IconButton>
                        <IconButton
                          variant="soft"
                          color="gray"
                          aria-label={`Settings for ${game.title}`}
                          title="Game settings"
                          onClick={() => setSettingsGame(game)}
                        >
                          <GearIcon />
                        </IconButton>
                        <Button disabled={!game.complete} onClick={() => onPlay(game)}>
                          <PlayIcon />
                          Play
                        </Button>
                      </Flex>
                    </Flex>
                  </div>
                ))}
                {(!choices.length || choices.some((game) => !game.complete) || installation.editions?.some((id) => !choices.some((game) => game.id === id && game.complete))) && (
                  <Button variant="soft" onClick={() => onResume?.(installation.slot)}>
                    Resume import
                  </Button>
                )}
                <AlertDialog.Root>
                  <AlertDialog.Trigger className={styles.removeTrigger}>
                    <IconButton
                      className={styles.removeButton}
                      variant="soft"
                      color="gray"
                      aria-label={`Remove ${displayName}`}
                      title="Remove installation"
                    >
                      <TrashIcon />
                    </IconButton>
                  </AlertDialog.Trigger>
                  <AlertDialog.Content maxWidth="440px">
                    <AlertDialog.Title>Remove {displayName}?</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                      This deletes this installation and its game editions from this browser (
                      {formatBytes(choices.reduce((sum, game) => sum + game.bytes, 0))}). Your own
                      folder is not touched, and you can import it again. Saved games and settings
                      are kept.
                    </AlertDialog.Description>
                    <Flex gap="3" mt="4" justify="end">
                      <AlertDialog.Cancel>
                        <Button variant="soft" color="gray">
                          Keep it
                        </Button>
                      </AlertDialog.Cancel>
                      <AlertDialog.Action>
                        <Button color="red" onClick={() => void remove(installation)}>
                          Remove
                        </Button>
                      </AlertDialog.Action>
                    </Flex>
                  </AlertDialog.Content>
                </AlertDialog.Root>
              </Flex>
            </Card>
          );
        })}
        <Flex>
          <Button variant="soft" onClick={onImport}>
            Import a folder…
          </Button>
        </Flex>
        <StorageMeter {...(estimate ? { estimate } : {})} refresh={removed} />
      </Flex>
      {settingsGame && (
        <LauncherGameSettings game={settingsGame} onClose={() => setSettingsGame(null)} />
      )}
      {importedSource && (
        <ReadOnlyFileExplorer source={importedSource} onClose={() => setBrowsing(null)} />
      )}
    </Flex>
  );
}
