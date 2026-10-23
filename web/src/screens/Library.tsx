import { AlertDialog, Button, Callout, Card, Flex, Heading, Link, Text } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { useState, type ReactNode } from "react";
import { formatBytes } from "../components/format";
import { StorageMeter } from "../components/StorageMeter";
import type { GameRecord } from "../storage/manifest";
import styles from "./Library.module.css";

export interface LibraryProps {
  games: GameRecord[];
  onPlay(game: GameRecord): void;
  /** the Import screen, for another game or to finish one */
  onImport(): void;
  /** forget the game and delete what only it reads; resolves when done */
  onRemove(game: GameRecord): Promise<void>;
  /** hands the player a zip of the game's saved games; says what happened ("No saved games yet") */
  onDownloadSaves(game: GameRecord): Promise<string>;
  /** takes saved games from a zip the player chose; says what happened */
  onImportSaves(game: GameRecord, zip: File): Promise<string>;
  estimate?: () => Promise<{ quota?: number; usage?: number }>;
  modManager?(game: GameRecord): ReactNode;
}

export function Library({
  games,
  onPlay,
  onImport,
  onRemove,
  onDownloadSaves,
  onImportSaves,
  estimate,
  modManager,
}: LibraryProps) {
  const [removed, setRemoved] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function say(work: Promise<string>) {
    try {
      setNotice(await work);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove(game: GameRecord) {
    try {
      await onRemove(game);
      setRemoved((n) => n + 1);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

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
        {games.map((game) => (
          <Card key={game.id} size="3" data-game-id={game.id}>
            <Flex justify="between" align="center" gap="4" wrap="wrap">
              <Flex direction="column" gap="1">
                <Heading size="4">{game.title}</Heading>
                <Text size="2" color="gray">
                  {formatBytes(game.bytes)} · {Object.keys(game.files).length} files · imported{" "}
                  {new Date(game.importedAt).toLocaleDateString()}
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
                      document.getElementById(`saves-${game.id}`)?.click();
                    }}
                  >
                    Import saves…
                  </Link>
                  <input
                    id={`saves-${game.id}`}
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
                    The import did not finish. Import it again to carry on.
                  </Text>
                )}
              </Flex>
              <Flex gap="2">
                <Button disabled={!game.complete} onClick={() => onPlay(game)}>
                  Play
                </Button>
                <AlertDialog.Root>
                  <AlertDialog.Trigger>
                    <Button variant="soft" color="gray">
                      Remove…
                    </Button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Content maxWidth="440px">
                    <AlertDialog.Title>Remove {game.title}?</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                      This deletes the copy of the game in this browser ({formatBytes(game.bytes)}).
                      Your own folder is not touched, and you can import it again. Saved games and
                      settings are kept.
                    </AlertDialog.Description>
                    <Flex gap="3" mt="4" justify="end">
                      <AlertDialog.Cancel>
                        <Button variant="soft" color="gray">
                          Keep it
                        </Button>
                      </AlertDialog.Cancel>
                      <AlertDialog.Action>
                        <Button color="red" onClick={() => void remove(game)}>
                          Remove
                        </Button>
                      </AlertDialog.Action>
                    </Flex>
                  </AlertDialog.Content>
                </AlertDialog.Root>
              </Flex>
            </Flex>
          </Card>
        ))}
        <Flex>
          <Button variant="soft" onClick={onImport}>
            Import a folder…
          </Button>
        </Flex>
        <StorageMeter {...(estimate ? { estimate } : {})} refresh={removed} />
      </Flex>
    </Flex>
  );
}
