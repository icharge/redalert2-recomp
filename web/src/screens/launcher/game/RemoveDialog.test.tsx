import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatBytes } from "../../../components/format";
import type { PartCounts, PartSizes } from "../../../storage/install-parts";
import { RemoveDialog, type RemoveDialogProps } from "./RemoveDialog";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const sizes: PartSizes = {
  game: 1 * GB,
  mods: 100 * MB,
  maps: 58 * MB,
  saves: 2 * MB,
  settings: 64 * 1024,
};
const counts: PartCounts = { mods: 3, maps: 2, saves: 4 };
const ALL_PARTS = ["game", "mods", "maps", "saves", "settings"];

function show(over: Partial<RemoveDialogProps> = {}) {
  const props: RemoveDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    editions: ["Red Alert 2", "Yuri’s Revenge"],
    sizes,
    counts,
    onRemove: vi.fn(async () => {}),
    ...over,
  };
  render(
    <Theme>
      <RemoveDialog {...props} />
    </Theme>,
  );
  return { props, user: userEvent.setup() };
}

const dialog = () => screen.getByRole("dialog");

describe("RemoveDialog", () => {
  it("starts with mods and maps ticked, and the button says their total", () => {
    show();
    expect(screen.getByRole("checkbox", { name: "Mods" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Custom maps" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Red Alert 2 and Yuri’s Revenge" }),
    ).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Saved games" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Settings and hotkeys" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: `REMOVE ${formatBytes(158 * MB)}` })).toBeEnabled();
  });

  it("disables a part with nothing in it", () => {
    show({ sizes: { ...sizes, mods: 0 } });
    expect(screen.getByRole("checkbox", { name: "Mods" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Custom maps" })).toBeEnabled();
    // the empty mods part is not counted in the button's total
    expect(screen.getByRole("button", { name: `REMOVE ${formatBytes(58 * MB)}` })).toBeEnabled();
  });

  it("warns when game content or saves are ticked", async () => {
    const { user } = show();
    expect(screen.queryByText(/Without game content, both games need installing again/)).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Red Alert 2 and Yuri’s Revenge" }));
    expect(
      screen.getByText(
        "Without game content, both games need installing again. The parts you keep stay here.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Saved games" }));
    expect(
      screen.getByText("Removed saves can't be brought back. Download them first to keep them."),
    ).toBeInTheDocument();
  });

  it("uses the one-edition warning copy when only one edition is installed", async () => {
    const { user } = show({ editions: ["Yuri’s Revenge"] });
    await user.click(screen.getByRole("checkbox", { name: "Yuri’s Revenge" }));
    expect(
      screen.getByText(
        "Without game content, the game needs installing again. The parts you keep stay here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/both games/)).toBeNull();
  });

  it("removes the ticked parts", async () => {
    const { props, user } = show();
    await user.click(screen.getByRole("button", { name: `REMOVE ${formatBytes(158 * MB)}` }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith(["mods", "maps"]));
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("removes only the game part when that is all that is ticked, keeping the rest", async () => {
    const { props, user } = show();
    await user.click(screen.getByRole("checkbox", { name: "Mods" }));
    await user.click(screen.getByRole("checkbox", { name: "Custom maps" }));
    await user.click(screen.getByRole("checkbox", { name: "Red Alert 2 and Yuri’s Revenge" }));
    await user.click(screen.getByRole("button", { name: `REMOVE ${formatBytes(1 * GB)}` }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith(["game"]));
  });

  it("disables REMOVE when nothing is ticked", async () => {
    const { user } = show();
    await user.click(screen.getByRole("checkbox", { name: "Mods" }));
    await user.click(screen.getByRole("checkbox", { name: "Custom maps" }));
    expect(screen.getByRole("button", { name: "REMOVE" })).toBeDisabled();
  });

  it("asks inline before removing everything", async () => {
    const { props, user } = show();
    const every = ALL_PARTS.reduce((sum, part) => sum + sizes[part as keyof PartSizes], 0);
    await user.click(
      screen.getByRole("button", { name: `REMOVE EVERYTHING · ${formatBytes(every)}` }),
    );
    const ask = within(dialog()).getByRole("group", { name: "Confirm remove everything" });
    expect(ask).toHaveTextContent(`Remove everything, ${formatBytes(every)}?`);
    expect(props.onRemove).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole("button", { name: "REMOVE EVERYTHING" }));
    await waitFor(() => expect(props.onRemove).toHaveBeenCalledWith(ALL_PARTS));
  });

  it("CANCEL in the remove everything strip goes back without removing", async () => {
    const { props, user } = show();
    await user.click(screen.getByRole("button", { name: /^REMOVE EVERYTHING · / }));
    await user.click(
      within(screen.getByRole("group", { name: "Confirm remove everything" })).getByRole("button", {
        name: "CANCEL",
      }),
    );
    expect(screen.queryByRole("group", { name: "Confirm remove everything" })).toBeNull();
    expect(props.onRemove).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the error when removing fails", async () => {
    const { props, user } = show({
      onRemove: vi.fn(async () => {
        throw new Error("storage said no");
      }),
    });
    await user.click(screen.getByRole("button", { name: `REMOVE ${formatBytes(158 * MB)}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("storage said no");
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(dialog()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `REMOVE ${formatBytes(158 * MB)}` })).toBeEnabled();
  });
});
