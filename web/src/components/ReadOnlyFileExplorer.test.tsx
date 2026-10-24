import { Theme } from "@radix-ui/themes";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplorerFolder, ExplorerInstance, ExplorerOptions } from "./file-explorer-assets";

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock("./file-explorer-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./file-explorer-assets")>()),
  loadFileExplorer: loadMock,
}));

import { ReadOnlyFileExplorer } from "./ReadOnlyFileExplorer";
import type { ReadOnlyFileSource } from "../storage/file-browser";

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
}

const source: ReadOnlyFileSource = {
  label: "Test game — imported files",
  rootLabel: "Test game (imported files)",
  list: vi.fn(async () => [{ name: "rules.ini", type: "file" as const, size: 20 }]),
  readText: vi.fn(async () => "<script>shown as plain text</script>"),
};

describe("ReadOnlyFileExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    options = undefined;
    loadMock.mockResolvedValue(FakeExplorer);
  });

  it("uses js-fileexplorer with mutation and download tools disabled", async () => {
    const view = render(
      <Theme>
        <ReadOnlyFileExplorer source={source} onClose={() => {}} />
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
        <ReadOnlyFileExplorer source={source} onClose={() => {}} />
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
});
