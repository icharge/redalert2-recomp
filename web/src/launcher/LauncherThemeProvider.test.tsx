import { Theme, Dialog, Button } from "@radix-ui/themes";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LauncherThemeProvider, useLauncherTheme } from "./LauncherThemeProvider";

function Picker() {
  const { theme, setTheme } = useLauncherTheme();
  return (
    <select
      aria-label="Theme"
      value={theme}
      onChange={(event) => setTheme(event.target.value as typeof theme)}
    >
      <option value="retro">Original</option>
      <option value="skeuomorphic">Industrial</option>
      <option value="framed-tech">Frames</option>
    </select>
  );
}
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-launcher-theme");
});

describe("shared launcher theme", () => {
  it("reaches a real Radix portal and updates while its dialog stays open", async () => {
    const user = userEvent.setup();
    render(
      <LauncherThemeProvider>
        <Theme>
          <Dialog.Root>
            <Dialog.Trigger>
              <Button>Open</Button>
            </Dialog.Trigger>
            <Dialog.Content>
              <Dialog.Title>Appearance test</Dialog.Title>
              <Dialog.Description>Shared state</Dialog.Description>
              <Picker />
            </Dialog.Content>
          </Dialog.Root>
        </Theme>
      </LauncherThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByRole("combobox"), "skeuomorphic");
    expect(document.documentElement).toHaveAttribute("data-launcher-theme", "skeuomorphic");
    expect(dialog).toBeInTheDocument();
    expect(localStorage.getItem("ra2.launcher.theme")).toBe("skeuomorphic");
  });
  it("keeps selection when the launcher content is replaced by another screen", async () => {
    const view = render(
      <LauncherThemeProvider>
        <Picker />
      </LauncherThemeProvider>,
    );
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "framed-tech");
    view.rerender(
      <LauncherThemeProvider>
        <p>Import screen</p>
      </LauncherThemeProvider>,
    );
    expect(document.documentElement).toHaveAttribute("data-launcher-theme", "framed-tech");
  });
  it("reuses the existing provider for nested launchers", async () => {
    render(
      <LauncherThemeProvider>
        <Picker />
        <LauncherThemeProvider>
          <Picker />
        </LauncherThemeProvider>
      </LauncherThemeProvider>,
    );
    const controls = screen.getAllByRole("combobox");
    await userEvent.setup().selectOptions(controls[1]!, "skeuomorphic");
    expect(controls[0]).toHaveValue("skeuomorphic");
    expect(document.documentElement).toHaveAttribute("data-launcher-theme", "skeuomorphic");
  });
  it("restores the document theme after unmount instead of leaking to other screens", () => {
    document.documentElement.setAttribute("data-launcher-theme", "framed-tech");
    const view = render(
      <LauncherThemeProvider>
        <Picker />
      </LauncherThemeProvider>,
    );
    expect(document.documentElement).toHaveAttribute("data-launcher-theme", "retro");
    view.unmount();
    expect(document.documentElement).toHaveAttribute("data-launcher-theme", "framed-tech");
  });
});
