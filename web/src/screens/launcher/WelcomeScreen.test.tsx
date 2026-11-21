import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { AccountClient } from "../../account/api";
import { FakeServer } from "../../account/fake-server";
import { AccountStore } from "../../account/store";
import {
  readWelcomeDismissed,
  showWelcome,
  writeWelcomeDismissed,
} from "../../storage/welcome-preferences";
import { WELCOME_REDIRECT, WelcomeScreen } from "./WelcomeScreen";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** A store over a fake server, as AccountScreen.test builds one; `fresh()` is another browser. */
function setup() {
  const server = new FakeServer();
  const fresh = () =>
    new AccountStore(
      new AccountClient({ baseUrl: "https://wol.test", fetch: server.fetch, locks: null }),
    );
  return { server, fresh };
}

function routes(installed: boolean, state?: unknown, store?: AccountStore) {
  return (
    <MemoryRouter initialEntries={[{ pathname: "/welcome", state }]}>
      <Routes>
        <Route path="/welcome" element={<WelcomeScreen installed={installed} store={store} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The page for a guest: a store that has restored to "guest" (no cookie). */
async function show(installed = false, state?: unknown) {
  const { server, fresh } = setup();
  const store = fresh();
  await store.restore();
  return { server, fresh, store, ...render(routes(installed, state, store)) };
}

afterEach(() => localStorage.clear());

describe("WelcomeScreen", () => {
  it("says what this is and that the player brings their own game", async () => {
    await show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("RED ALERT 2 ONLINE");
    expect(screen.getByText("WELCOME TO YURINET")).toBeInTheDocument();
    expect(screen.getByText(/Bring your own copy of the game/)).toHaveTextContent(/never uploaded/);
    expect(screen.getByRole("link", { name: "Install guide" })).toHaveAttribute(
      "href",
      "/install/guide",
    );
  });

  it("opens on CREATE ACCOUNT, with the member registration fields", async () => {
    await show();
    expect(screen.getByRole("tab", { name: "CREATE ACCOUNT" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "LOGIN" })).toHaveAttribute("aria-selected", "false");
    const form = within(screen.getByRole("form", { name: "Create account" }));
    expect(form.getByLabelText("Login")).toBeInTheDocument();
    expect(form.getByLabelText("Email (optional)")).toBeInTheDocument();
    expect(form.getByLabelText("Password")).toBeInTheDocument();
    expect(form.getByRole("button", { name: "CREATE ACCOUNT" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Login" })).toBeNull();
  });

  it("switches to LOGIN and back", async () => {
    await show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "LOGIN" }));
    expect(screen.getByRole("tab", { name: "LOGIN" })).toHaveAttribute("aria-selected", "true");
    const form = within(screen.getByRole("form", { name: "Login" }));
    expect(form.getByLabelText("Name or email")).toBeInTheDocument();
    expect(form.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Create account" })).toBeNull();
    // no route resets a password, so there is no such link
    expect(screen.queryByText(/forgot password/i)).toBeNull();
    await user.click(screen.getByRole("tab", { name: "CREATE ACCOUNT" }));
    expect(screen.getByRole("form", { name: "Create account" })).toBeInTheDocument();
  });

  it("the arrow keys move between the tabs", async () => {
    await show();
    const user = userEvent.setup();
    screen.getByRole("tab", { name: "CREATE ACCOUNT" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "LOGIN" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "LOGIN" })).toHaveFocus();
  });

  it("creates a member through the api, then goes to PLAY's no-game state when nothing is installed", async () => {
    const { server, store } = await show(false);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "Create account" }));
    await user.type(form.getByLabelText("Login"), "carol");
    await user.type(form.getByLabelText("Email (optional)"), "carol@example.com");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(form.getByRole("button", { name: "CREATE ACCOUNT" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/");
    expect(server.calls.some((call) => call.path === "/v1/members/register")).toBe(true);
    const state = store.getState();
    expect(state.status === "member" && state.member.login).toBe("carol");
    expect(state.status === "member" && state.member.email).toBe("carol@example.com");
  });

  it("a new member with a game installed goes to ACCOUNT, to get a game account", async () => {
    await show(true);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "Create account" }));
    await user.type(form.getByLabelText("Login"), "carol");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(form.getByRole("button", { name: "CREATE ACCOUNT" }));
    expect(await screen.findByTestId("where")).toHaveTextContent("/account");
  });

  it("shows what the server refuses and stays on the page", async () => {
    const { server, fresh } = setup();
    await fresh().register("carol", "secret-pass");
    server.cookie = null;
    const store = fresh();
    await store.restore();
    render(routes(true, undefined, store));
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "Create account" }));
    await user.type(form.getByLabelText("Login"), "carol");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(form.getByRole("button", { name: "CREATE ACCOUNT" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That login is taken.");
    expect(screen.queryByTestId("where")).toBeNull();
    expect(store.getState().status).toBe("guest");
  });

  describe("LOGIN", () => {
    /** A member (with a game account, or without) who is signed out in this browser. */
    async function memberLoggedOut(gameAccount: boolean, installed: boolean) {
      const { server, fresh } = setup();
      const other = fresh();
      await other.register("carol", "secret-pass");
      if (gameAccount) await other.addGameAccount("Carol");
      server.cookie = null;
      const store = fresh();
      await store.restore();
      render(routes(installed, undefined, store));
      await userEvent.setup().click(screen.getByRole("tab", { name: "LOGIN" }));
      return { server, store };
    }

    async function login(password = "secret-pass") {
      const user = userEvent.setup();
      const form = within(screen.getByRole("form", { name: "Login" }));
      await user.type(form.getByLabelText("Name or email"), "carol");
      await user.type(form.getByLabelText("Password"), password);
      await user.click(form.getByRole("button", { name: "LOGIN" }));
    }

    it("signs in through the api and, with a game and a game account, goes to PLAY", async () => {
      const { server, store } = await memberLoggedOut(true, true);
      await login();
      expect((await screen.findByTestId("where")).textContent).toBe("/");
      expect(server.calls.some((call) => call.path === "/v1/members/login")).toBe(true);
      expect(store.getState().status).toBe("member");
    });

    it("with nothing installed goes to PLAY (its no-game state)", async () => {
      await memberLoggedOut(true, false);
      await login();
      expect((await screen.findByTestId("where")).textContent).toBe("/");
    });

    it("a member without a game account goes to ACCOUNT to get one", async () => {
      await memberLoggedOut(false, true);
      await login();
      expect(await screen.findByTestId("where")).toHaveTextContent("/account");
    });

    it("a wrong password is shown, and the page stays", async () => {
      const { store } = await memberLoggedOut(true, true);
      await login("not-the-pass");
      expect(await screen.findByRole("alert")).toHaveTextContent("The login or password is wrong.");
      expect(screen.queryByTestId("where")).toBeNull();
      expect(store.getState().status).toBe("guest");
    });
  });

  it("a member who is already signed in sees who, and CONTINUE goes on", async () => {
    const { fresh } = setup();
    const store = fresh();
    await store.register("carol", "secret-pass");
    await store.addGameAccount("Carol");
    render(routes(true, undefined, store));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("carol")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "CONTINUE" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("a guest with nothing installed goes to PLAY (its no-game state)", async () => {
    await show();
    expect(screen.getByRole("link", { name: "PLAY AS GUEST" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Guests play online unranked, with no clan.")).toBeInTheDocument();
  });

  it("with a game installed the guest goes to PLAY", async () => {
    await show(true);
    expect(screen.getByRole("link", { name: "PLAY AS GUEST" })).toHaveAttribute("href", "/");
  });

  it("DON'T SHOW THIS AGAIN remembers the dismissal and goes to PLAY", async () => {
    await show();
    expect(readWelcomeDismissed()).toBe(false);
    await userEvent.setup().click(screen.getByRole("button", { name: "DON'T SHOW THIS AGAIN" }));
    expect(readWelcomeDismissed()).toBe(true);
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });
});

describe("the redirect from /", () => {
  it("goes back to PLAY once an install shows up", async () => {
    const { store, rerender } = await show(false, WELCOME_REDIRECT);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    rerender(routes(true, WELCOME_REDIRECT, store));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });

  it("a visit the player asked for stays, installed or not", async () => {
    await show(true);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByTestId("where")).toBeNull();
  });
});

describe("showWelcome", () => {
  it("shows on a first run and while nothing is installed, until dismissed", () => {
    expect(showWelcome(false)).toBe(true);
    expect(showWelcome(true)).toBe(false);
    writeWelcomeDismissed();
    expect(showWelcome(false)).toBe(false);
  });

  it("shows when the browser's storage cannot be read", () => {
    const broken = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(showWelcome(false, broken)).toBe(true);
    expect(showWelcome(false, null)).toBe(true);
  });
});
