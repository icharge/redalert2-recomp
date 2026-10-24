import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerFolder, ExplorerInstance, ExplorerOptions } from "./file-explorer-assets";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("./file-explorer-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./file-explorer-assets")>()),
  loadFileExplorer: loadMock,
}));

import { FileExplorer } from "./FileExplorer";
import type { ReadOnlyFileSource, UploadReport } from "../storage/file-browser";

const folder: ExplorerFolder = {
  GetPathIDs: () => ["root"],
  SetEntries: vi.fn(),
};
let options: ExplorerOptions | undefined;
const destroy = vi.fn();

class FakeExplorer implements ExplorerInstance {
  constructor(_parent: HTMLElement, next: ExplorerOptions) {
    options = next;
    next.onrefresh(folder, true);
  }
  Destroy = destroy;
  IsDestroyed = () => false;
  IsMappedFolder = () => true;
  GetCurrentFolder = () => folder;
  RefreshFolders = refreshFolders;
}
const refreshFolders = vi.fn();

const source: ReadOnlyFileSource = {
  label: "Test game — imported files",
  rootLabel: "Test game (imported files)",
  list: vi.fn(async () => [{ name: "rules.ini", type: "file" as const, size: 20 }]),
  readText: vi.fn(async () => "<script>shown as plain text</script>"),
};

describe("FileExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    options = undefined;
    loadMock.mockResolvedValue(FakeExplorer);
  });

  it("uses js-fileexplorer with mutation and download tools disabled", async () => {
    const view = render(
      <Theme>
        <FileExplorer source={source} onClose={() => {}} />
      </Theme>,
    );
    await waitFor(() => expect(folder.SetEntries).toHaveBeenCalled());
    expect(options?.initpath[0]?.[2]).toEqual({ canmodify: false });
    expect(Object.values(options?.tools ?? {}).every((enabled) => !enabled)).toBe(true);
    expect(options).not.toHaveProperty("onnewfolder");
    expect(options).not.toHaveProperty("onnewfile");
    expect(options).not.toHaveProperty("onrename");
    expect(options).not.toHaveProperty("ondelete");
    expect(options).not.toHaveProperty("oninitupload");
    expect(options).not.toHaveProperty("oninitdownload");
    view.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("renders opened text as inert content", async () => {
    render(
      <Theme>
        <FileExplorer source={source} onClose={() => {}} />
      </Theme>,
    );
    await waitFor(() => expect(options).toBeDefined());
    options?.onopenfile(folder, {
      id: "rules.ini",
      name: "rules.ini",
      type: "file",
      hash: "file:20:0",
      attrs: { canmodify: false },
      size: 20,
    });
    const reader = await screen.findByRole("region", { name: "Text file rules.ini" });
    expect(reader.querySelector("script")).toBeNull();
    expect(reader).toHaveTextContent("<script>shown as plain text</script>");
    expect(source.readText).toHaveBeenCalledWith("rules.ini");
  });

  it("keeps the file browser's node mounted while a file is open, so Back shows it again", async () => {
    render(
      <Theme>
        <FileExplorer source={source} onClose={() => {}} />
      </Theme>,
    );
    await waitFor(() => expect(options).toBeDefined());
    const host = screen.getByTestId("read-only-file-explorer");
    options?.onopenfile(folder, {
      id: "rules.ini",
      name: "rules.ini",
      type: "file",
      hash: "file:20:0",
      attrs: { canmodify: false },
      size: 20,
    });
    await screen.findByRole("region", { name: "Text file rules.ini" });
    expect(host).not.toBeVisible();
    screen.getByRole("button", { name: "Back to files" }).click();
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(screen.getByTestId("read-only-file-explorer")).toBe(host);
    expect(host).toBeVisible();
  });

  describe("when the source can be managed", () => {
    const manage = {
      clashes: vi.fn(async (_folder: string, names: string[]) =>
        names.filter((n) => n === "rules.ini"),
      ),
      upload: vi.fn(async (): Promise<UploadReport> => ({
        added: ["new.ini"],
        replaced: [],
        problems: [],
        notes: [],
      })),
      removeWarning: vi.fn(() => "The game may not start without files it reads."),
      remove: vi.fn(async () => ["Cleared the saved copy."]),
    };
    const managed: ReadOnlyFileSource = { ...source, manage };
    const show = async () => {
      render(
        <Theme>
          <FileExplorer source={managed} onClose={() => {}} />
        </Theme>,
      );
      await waitFor(() => expect(options).toBeDefined());
    };
    const entry = (name: string, locked = false) => ({
      id: name,
      name,
      type: "file" as const,
      hash: "file:1:1",
      attrs: { canmodify: true, ...(locked ? { locked } : {}) },
    });

    it("turns on only the delete tool, and makes the folder and its entries changeable", async () => {
      await show();
      expect(options?.tools.delete).toBe(true);
      expect(Object.entries(options?.tools ?? {}).filter(([, on]) => on)).toEqual([
        ["delete", true],
      ]);
      expect(options?.initpath[0]?.[2]).toEqual({ canmodify: true });
      expect(options).not.toHaveProperty("oninitupload");
      expect(options).not.toHaveProperty("oninitdownload");
      await waitFor(() => expect(folder.SetEntries).toHaveBeenCalled());
      expect(vi.mocked(folder.SetEntries).mock.calls[0]?.[0][0]?.attrs).toEqual({
        canmodify: true,
      });
    });

    it("uploads the chosen files into the folder that is open", async () => {
      await show();
      const input = screen.getByLabelText("Files to upload");
      const file = new File(["x"], "new.ini");
      await userEvent.upload(input, file);
      await waitFor(() => expect(manage.upload).toHaveBeenCalledWith("", [file]));
      expect(await screen.findByText(/Added new\.ini/)).toBeInTheDocument();
      expect(refreshFolders).toHaveBeenCalled();
    });

    it("keeps saying why a file was refused when the widget refreshes its listing", async () => {
      manage.upload.mockResolvedValueOnce({
        added: [],
        replaced: [],
        problems: ["notes.docx: the game does not read a file like this from here."],
        notes: [],
      });
      await show();
      await userEvent.upload(
        screen.getByLabelText("Files to upload"),
        new File(["x"], "notes.docx"),
      );
      expect(await screen.findByText(/notes\.docx: the game does not read/)).toBeInTheDocument();
      options?.onrefresh(folder, true);
      await waitFor(() => expect(source.list).toHaveBeenCalledTimes(2));
      expect(screen.getByText(/notes\.docx: the game does not read/)).toBeInTheDocument();
    });

    it("asks before replacing a file, and does nothing if the player keeps the old one", async () => {
      await show();
      await userEvent.upload(
        screen.getByLabelText("Files to upload"),
        new File(["x"], "rules.ini"),
      );
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent("rules.ini");
      expect(manage.upload).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: /Keep the old one/ }));
      expect(manage.upload).not.toHaveBeenCalled();
      await userEvent.upload(
        screen.getByLabelText("Files to upload"),
        new File(["x"], "rules.ini"),
      );
      await userEvent.click(await screen.findByRole("button", { name: "Replace" }));
      await waitFor(() => expect(manage.upload).toHaveBeenCalledOnce());
    });

    it("deletes only after the player confirms, and tells the widget how it went", async () => {
      await show();
      const done = vi.fn();
      options?.ondelete?.(done, folder, ["rules.ini"], [entry("rules.ini")]);
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent("The game may not start");
      expect(manage.remove).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(done).toHaveBeenCalledOnce());
      expect(done).toHaveBeenCalledWith(true);
      expect(manage.remove).toHaveBeenCalledWith(["rules.ini"]);
      expect(await screen.findByText("Cleared the saved copy.")).toBeInTheDocument();
    });

    it("reports a cancelled delete to the widget and removes nothing", async () => {
      await show();
      const done = vi.fn();
      options?.ondelete?.(done, folder, ["rules.ini"], [entry("rules.ini")]);
      await userEvent.click(await screen.findByRole("button", { name: "Keep it" }));
      await waitFor(() => expect(done).toHaveBeenCalledWith("Cancelled."));
      expect(manage.remove).not.toHaveBeenCalled();
    });

    it("will not delete a folder the game keeps", async () => {
      await show();
      const done = vi.fn();
      options?.ondelete?.(done, folder, ["Saves"], [entry("Saves", true)]);
      expect(done).toHaveBeenCalledWith(expect.stringMatching(/kept by the game/));
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });
});
