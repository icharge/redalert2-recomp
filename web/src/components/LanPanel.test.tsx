import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameHandle } from "../game/loader";
import { LanPanel } from "./LanPanel";
import { gameStore } from "../game/store";

function gameHandle(): GameHandle {
  const heap = new Uint8Array(1024);
  return {
    exports: {
      ra2_net_buffer: () => 16,
      ra2_net_pop: vi.fn(() => 0),
      ra2_net_push: vi.fn(() => 0),
    } as unknown as GameHandle["exports"],
    memory: () => ({ HEAPU8: heap, HEAP32: new Int32Array(heap.buffer) }),
    shared: 0,
    saves: null,
  } as unknown as GameHandle;
}

function installPeerHarness(delayFirstOffer = false) {
  let releaseFirstOffer: (() => void) | null = null;
  class Channel {
    readyState: RTCDataChannelState = "connecting";
    bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    onopen: ((event: Event) => void) | null = null;
    onclose: ((event: Event) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    close = vi.fn();
    send() {}
  }
  class Connection extends EventTarget {
    iceGatheringState: RTCIceGatheringState = "complete";
    signalingState: RTCSignalingState = "stable";
    connectionState: RTCPeerConnectionState = "new";
    localDescription: RTCSessionDescription | null = null;
    onconnectionstatechange: ((event: Event) => void) | null = null;
    ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
    channel = new Channel();
    createDataChannel() {
      return this.channel as unknown as RTCDataChannel;
    }
    async createOffer() {
      const index = connections.indexOf(this);
      if (delayFirstOffer && index === 0) {
        await new Promise<void>((resolve) => {
          releaseFirstOffer = resolve;
        });
      }
      return { type: "offer", sdp: `fake-offer-${index + 1}` } as RTCSessionDescriptionInit;
    }
    async createAnswer() {
      return {
        type: "answer",
        sdp: `fake-answer-${connections.indexOf(this) + 1}`,
      } as RTCSessionDescriptionInit;
    }
    async setLocalDescription(description: RTCSessionDescriptionInit) {
      this.localDescription = description as RTCSessionDescription;
    }
    async setRemoteDescription() {}
    close = vi.fn();
  }
  const connections: Connection[] = [];
  vi.stubGlobal(
    "RTCPeerConnection",
    class extends Connection {
      constructor() {
        super();
        connections.push(this);
      }
    },
  );
  return { connections, resolveFirstOffer: () => releaseFirstOffer?.() };
}

describe("LanPanel", () => {
  it("stops polling exports immediately when the runtime exits", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    render(<LanPanel game={game} request={1} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const pop = vi.mocked(game.exports.ra2_net_pop);
    expect(pop).toHaveBeenCalled();
    pop.mockClear();
    act(() => {
      gameStore.line('@ra2 {"e":"exit","code":0}');
      vi.advanceTimersByTime(100);
    });
    expect(pop).not.toHaveBeenCalled();
    vi.useRealTimers();
    gameStore.begin();
  });

  it("does not duplicate bridge polling across StrictMode effect cleanup and remount", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    render(
      <StrictMode>
        <LanPanel game={game} request={2} />
      </StrictMode>,
    );
    act(() => vi.advanceTimersByTime(8));
    expect(game.exports.ra2_net_pop).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    gameStore.begin();
  });

  it("enables invitation actions after the player pastes signaling text", async () => {
    const user = userEvent.setup();
    render(<LanPanel game={gameHandle()} request={1} onContinue={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Join WebRTC session" }));

    const join = screen.getByRole("button", { name: "Join with invitation" });
    expect(join).toBeDisabled();
    await user.type(screen.getByLabelText("LAN invitation to join"), "offer text");
    expect(join).toBeEnabled();
  });

  it("keeps manual invitation paste available when clipboard access is denied", async () => {
    const user = userEvent.setup();
    const fakeNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(fakeNavigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.stubGlobal("navigator", fakeNavigator);
    render(<LanPanel game={gameHandle()} request={1} onContinue={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Join WebRTC session" }));
    await user.click(screen.getByRole("button", { name: "Paste from clipboard" }));
    expect(screen.getByRole("alert")).toHaveTextContent("paste the text manually");
    await user.type(screen.getByLabelText("LAN invitation to join"), "offer text");
    expect(screen.getByRole("button", { name: "Join with invitation" })).toBeEnabled();
  });

  it("shows the completed SDP offer in a copyable field", async () => {
    class DataChannel {
      readyState: RTCDataChannelState = "connecting";
      bufferedAmount = 0;
      binaryType: BinaryType = "blob";
      onopen: ((event: Event) => void) | null = null;
      onclose: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      close() {}
      send() {}
    }
    let pairingChannel: DataChannel | null = null;
    class PeerConnection extends EventTarget {
      iceGatheringState: RTCIceGatheringState = "complete";
      signalingState: RTCSignalingState = "stable";
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescription | null = null;
      onconnectionstatechange: ((event: Event) => void) | null = null;
      ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
      createDataChannel() {
        pairingChannel = new DataChannel();
        return pairingChannel as unknown as RTCDataChannel;
      }
      async createOffer() {
        return { type: "offer", sdp: "fake-offer-sdp" } as RTCSessionDescriptionInit;
      }
      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description as RTCSessionDescription;
        this.signalingState = "have-local-offer";
      }
      async setRemoteDescription() {
        this.signalingState = "stable";
      }
      close() {}
    }
    vi.stubGlobal("RTCPeerConnection", PeerConnection);

    const user = userEvent.setup();
    const game = gameHandle();
    const onContinue = vi.fn(() => false);
    render(<LanPanel game={game} request={1} onContinue={onContinue} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));

    const invitation = await screen.findByLabelText("LAN invitation");
    await waitFor(() =>
      expect(invitation).toHaveValue(JSON.stringify({ type: "offer", sdp: "fake-offer-sdp" })),
    );
    const continueButton = screen.getByRole("button", { name: "Continue to LAN lobby" });
    expect(continueButton).toBeDisabled();
    (pairingChannel as unknown as DataChannel).onopen?.(new Event("open"));
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);
    expect(onContinue).toHaveBeenCalledWith(1);
    expect(screen.getByRole("dialog", { name: "LAN multiplayer" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("prompt remains available");
    fireEvent.change(screen.getByLabelText("LAN answer to connect"), {
      target: { value: JSON.stringify({ type: "answer", sdp: "fake-answer-sdp" }) },
    });
    await user.click(screen.getByRole("button", { name: "Connect with answer" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Connecting"));
  });

  it("opens from the caller's state and reports close, without a trigger of its own", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<LanPanel game={gameHandle()} open onOpenChange={onOpenChange} showTrigger={false} />);
    expect(screen.queryByRole("button", { name: "LAN" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "LAN multiplayer" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not poll game exports until a native LAN session begins", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    const { rerender } = render(<LanPanel game={game} />);
    const pop = vi.mocked(game.exports.ra2_net_pop);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(pop).not.toHaveBeenCalled();
    rerender(<LanPanel game={game} request={10} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(pop).toHaveBeenCalled();
    pop.mockClear();
    rerender(<LanPanel game={game} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(pop).not.toHaveBeenCalled();
    vi.useRealTimers();
    gameStore.begin();
  });

  it("stops polling exports when the runtime crashes", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    render(<LanPanel game={game} request={3} />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const pop = vi.mocked(game.exports.ra2_net_pop);
    expect(pop).toHaveBeenCalled();
    pop.mockClear();
    act(() => {
      gameStore.crashed("the game stopped");
      vi.advanceTimersByTime(100);
    });
    expect(pop).not.toHaveBeenCalled();
    vi.useRealTimers();
    gameStore.begin();
  });

  it.each(["connection-state", "channel-error"] as const)(
    "offers Retry after an asynchronous pending %s failure",
    async (failure) => {
      const harness = installPeerHarness();
      const { connections } = harness;
      const user = userEvent.setup();
      render(<LanPanel game={gameHandle()} request={21} />);
      await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
      await screen.findByLabelText("LAN invitation");
      const connection = connections[0]!;
      act(() => {
        if (failure === "connection-state") {
          connection.connectionState = "failed";
          connection.onconnectionstatechange?.(new Event("connectionstatechange"));
        } else {
          connection.channel.onerror?.(new Event("error"));
        }
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(/failed|retry/i);
      await user.click(screen.getByRole("button", { name: "Retry" }));
      await user.click(await screen.findByRole("button", { name: "Create WebRTC session" }));
      await waitFor(() => expect(harness.connections).toHaveLength(2));
      expect(await screen.findByLabelText("LAN invitation")).toHaveValue(
        JSON.stringify({ type: "offer", sdp: "fake-offer-2" }),
      );
    },
  );

  it("retries a failed joiner attempt with the pasted invitation intact", async () => {
    const { connections } = installPeerHarness();
    const user = userEvent.setup();
    const invite = JSON.stringify({ type: "offer", sdp: "received-offer" });
    render(<LanPanel game={gameHandle()} request={22} />);
    await user.click(screen.getByRole("button", { name: "Join WebRTC session" }));
    fireEvent.change(screen.getByLabelText("LAN invitation to join"), {
      target: { value: invite },
    });
    await user.click(screen.getByRole("button", { name: "Join with invitation" }));
    await screen.findByLabelText("LAN answer");
    const connection = connections[0]!;
    act(() => {
      connection.ondatachannel?.({ channel: connection.channel } as unknown as RTCDataChannelEvent);
      connection.channel.onerror?.(new Event("error"));
    });

    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await user.click(await screen.findByRole("button", { name: "Join WebRTC session" }));
    expect(screen.getByLabelText("LAN invitation to join")).toHaveValue(invite);
    await user.click(screen.getByRole("button", { name: "Join with invitation" }));
    await waitFor(() => expect(connections).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByLabelText("LAN answer")).toHaveValue(
        JSON.stringify({ type: "answer", sdp: "fake-answer-2" }),
      ),
    );
  });

  it("closes the old peer and ignores its callbacks when a request is replaced directly", async () => {
    const { connections } = installPeerHarness();
    const user = userEvent.setup();
    const game = gameHandle();
    const { rerender } = render(<LanPanel game={game} request={31} activeRequest={31} />);
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    await screen.findByLabelText("LAN invitation");
    const oldConnection = connections[0]!;
    act(() => {
      oldConnection.channel.readyState = "open";
      oldConnection.channel.onopen?.(new Event("open"));
    });
    expect(screen.getByRole("button", { name: "Continue to LAN lobby" })).toBeEnabled();

    rerender(<LanPanel game={game} request={32} activeRequest={32} />);
    expect(oldConnection.close).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    await screen.findByLabelText("LAN invitation");
    act(() => oldConnection.channel.onopen?.(new Event("open")));
    expect(screen.getByRole("button", { name: "Continue to LAN lobby" })).toBeDisabled();
  });

  it("does not let delayed SDP from a replaced request overwrite the new invitation", async () => {
    const harness = installPeerHarness(true);
    const user = userEvent.setup();
    const game = gameHandle();
    const { rerender } = render(<LanPanel game={game} request={41} activeRequest={41} />);
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    await waitFor(() => expect(harness.connections).toHaveLength(1));

    rerender(<LanPanel game={game} request={42} activeRequest={42} />);
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    await screen.findByLabelText("LAN invitation");
    harness.resolveFirstOffer();
    await waitFor(() =>
      expect(screen.getByLabelText("LAN invitation")).toHaveValue(
        JSON.stringify({ type: "offer", sdp: "fake-offer-2" }),
      ),
    );
  });

  it("stops bridge polling when the active LAN session ends", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    const { rerender } = render(<LanPanel game={game} activeRequest={88} />);
    const pop = vi.mocked(game.exports.ra2_net_pop);
    act(() => vi.advanceTimersByTime(16));
    expect(pop).toHaveBeenCalled();
    pop.mockClear();
    act(() => {
      gameStore.line('@ra2 {"e":"lanSessionEnd","request":88}');
      rerender(<LanPanel game={game} activeRequest={null} />);
    });
    act(() => vi.advanceTimersByTime(32));
    expect(pop).not.toHaveBeenCalled();
  });

  it("stops bridge polling on Disconnect and restarts it for a fresh attempt", async () => {
    vi.useFakeTimers();
    gameStore.begin();
    const { connections } = installPeerHarness();
    const game = gameHandle();
    render(<LanPanel game={game} request={89} activeRequest={89} />);
    const pop = vi.mocked(game.exports.ra2_net_pop);
    act(() => vi.advanceTimersByTime(16));
    expect(pop).toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create WebRTC session" }));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    pop.mockClear();
    act(() => vi.advanceTimersByTime(32));
    expect(pop).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    expect(connections).toHaveLength(2);
    act(() => vi.advanceTimersByTime(8));
    expect(pop).toHaveBeenCalled();
  });
});

describe("controlled LAN session", () => {
  it("shows only the exact Create, Join and Cancel choices for a native request", () => {
    const game = gameHandle();
    game.exports.ra2_lan_session_reply = vi.fn(() => 1) as never;
    render(<LanPanel game={game} request={44} onContinue={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "LAN multiplayer" });
    expect(
      within(dialog).getByRole("button", { name: "Create WebRTC session" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Join WebRTC session" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "LAN" })).toBeNull();
  });

  it("offers retry after malformed invitation text and preserves the pasted text", async () => {
    const user = userEvent.setup();
    render(<LanPanel game={gameHandle()} request={45} onContinue={vi.fn()} onCancel={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Join WebRTC session" }));
    const invitation = screen.getByLabelText("LAN invitation to join");
    await user.type(invitation, "bad invitation");
    await user.click(screen.getByRole("button", { name: "Join with invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("valid invitation text");
    const retry = screen.getByRole("button", { name: "Retry" });
    await user.click(retry);
    expect(invitation).toHaveValue("bad invitation");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a failed native acknowledgement visible and only invokes Cancel once on Escape", async () => {
    const user = userEvent.setup();
    const game = gameHandle();
    game.exports.ra2_lan_session_reply = vi.fn(() => 0) as never;
    const onContinue = vi.fn();
    const onCancel = vi.fn();
    render(<LanPanel game={game} request={44} onContinue={onContinue} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Create WebRTC session" }));
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledWith(44);
    expect(screen.getByRole("dialog", { name: "LAN multiplayer" })).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
