import { Dialog } from "@radix-ui/themes";
import type { CSSProperties, ReactNode } from "react";
import { appPath } from "../paths";
import styles from "./GameDialogChrome.module.css";
import { GAME_DIALOG_PALETTE } from "./game-dialog-palette";

/**
 * The link dialog dressed as one of the game's own panels: a metal-beveled
 * frame, the embedded WOL browser's title strip, a starfield body and red
 * button plates. docs/web/frontend.md and tools/export_dialog_art.py explain
 * where the art comes from.
 *
 * The images are optional. Each one is layered under a gradient sampled from
 * the same art (game-dialog-palette.ts), so a checkout without the retail
 * files still gets the game's colours and bevels. Radix's Dialog stays the
 * accessible shell: Dialog.Title supplies the label, Escape and focus
 * trapping are unchanged, and the buttons are real DOM controls.
 */
export function GameDialogChrome({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.chrome} style={ART} data-testid="game-dialog-chrome">
      <div className={styles.titleBar}>
        <Dialog.Title className={styles.title}>{title}</Dialog.Title>
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  );
}

/** The plate class the dialog's actions use (real text over the button art). */
export const gameDialogButtonClass = styles.plate;

const art = (name: string) => `url("${appPath(`dialog-art/${name}`)}")`;

const ART = {
  "--gd-metal-light": GAME_DIALOG_PALETTE.metalLight,
  "--gd-metal": GAME_DIALOG_PALETTE.metal,
  "--gd-metal-dark": GAME_DIALOG_PALETTE.metalDark,
  "--gd-plate": GAME_DIALOG_PALETTE.plate,
  "--gd-plate-light": GAME_DIALOG_PALETTE.plateLight,
  "--gd-plate-dark": GAME_DIALOG_PALETTE.plateDark,
  "--gd-accent": GAME_DIALOG_PALETTE.accent,
  "--gd-ink": GAME_DIALOG_PALETTE.ink,
  "--gd-title-art": art("title.png"),
  "--gd-background-art": art("background.jpg"),
  "--gd-button-art": art("button.png"),
  "--gd-button-hover-art": art("button-hover.png"),
} as CSSProperties;
