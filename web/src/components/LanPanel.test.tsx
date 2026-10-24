import { act, render, screen, waitFor } from "@testing-library/react";
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

describe("LanPanel", () => {
  it("stops polling exports immediately when the runtime exits", () => {
    vi.useFakeTimers();
    gameStore.begin();
    const game = gameHandle();
    render(<LanPanel game={game} />);
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    gameStore.begin();
  });

  it("enables invitation actions after the player pastes signaling text", async () => {
    const user = userEvent.setup();
    render(<LanPanel game={gameHandle()} />);
    await user.click(screen.getByRole("button", { name: "LAN" }));

    const join = screen.getByRole("button", { name: "Join with invitation" });
    expect(join).toBeDisabled();
    await user.type(screen.getByLabelText("LAN invitation to join"), "offer text");
    expect(join).toBeEnabled();
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
    class PeerConnection extends EventTarget {
      iceGatheringState: RTCIceGatheringState = "complete";
      signalingState: RTCSignalingState = "stable";
      connectionState: RTCPeerConnectionState = "new";
      localDescription: RTCSessionDescription | null = null;
      onconnectionstatechange: ((event: Event) => void) | null = null;
      ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null;
      createDataChannel() {
        return new DataChannel() as unknown as RTCDataChannel;
      }
      async createOffer() {
        return { type: "offer", sdp: "fake-offer-sdp" } as RTCSessionDescriptionInit;
      }
      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description as RTCSessionDescription;
        this.signalingState = "have-local-offer";
      }
      close() {}
    }
    vi.stubGlobal("RTCPeerConnection", PeerConnection);

    const user = userEvent.setup();
    render(<LanPanel game={gameHandle()} />);
    await user.click(screen.getByRole("button", { name: "LAN" }));
    await user.click(screen.getByRole("button", { name: "Create invitation" }));

    const invitation = await screen.findByLabelText("LAN invitation");
    await waitFor(() =>
      expect(invitation).toHaveValue(JSON.stringify({ type: "offer", sdp: "fake-offer-sdp" })),
    );
  });
});
