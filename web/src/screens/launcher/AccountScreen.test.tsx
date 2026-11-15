import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { AccountClient } from "../../account/api";
import { FakeServer } from "../../account/fake-server";
import { AccountStore } from "../../account/store";
import { AccountScreen } from "./AccountScreen";
import { Shell } from "./Shell";

function setup() {
  const server = new FakeServer();
  const store = () =>
    new AccountStore(
      new AccountClient({ baseUrl: "https://wol.test", fetch: server.fetch, locks: null }),
    );
  return { server, store };
}

function show(store: AccountStore) {
  render(
    <MemoryRouter>
      <AccountScreen store={store} />
    </MemoryRouter>,
  );
}

async function signInAs(store: AccountStore, login = "carol") {
  await store.register(login, "secret-pass");
}

describe("AccountScreen", () => {
  it("shows the guest the sign-in and create-member forms", async () => {
    const { store } = setup();
    const s = store();
    await s.restore();
    show(s);
    expect(screen.getByRole("form", { name: "SIGN IN" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "CREATE A MEMBER" })).toBeInTheDocument();
    expect(screen.getByText(/playing as a guest/)).toBeInTheDocument();
  });

  it("signs in with a login and password", async () => {
    const { server, store } = setup();
    await signInAs(store());
    server.cookie = null;
    const s = store();
    await s.restore();
    show(s);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "SIGN IN" }));
    await user.type(form.getByLabelText("Login or email"), "carol");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "SIGN IN" }));
    expect(await screen.findByRole("button", { name: "SIGN OUT" })).toBeInTheDocument();
    expect(screen.getByText("carol")).toBeInTheDocument();
  });

  it("shows a wrong password and stays a guest", async () => {
    const { server, store } = setup();
    await signInAs(store());
    server.cookie = null;
    const s = store();
    await s.restore();
    show(s);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "SIGN IN" }));
    await user.type(form.getByLabelText("Login or email"), "carol");
    await user.type(form.getByLabelText("Password"), "not-the-pass");
    await user.click(screen.getByRole("button", { name: "SIGN IN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The login or password is wrong.");
    expect(s.getState().status).toBe("guest");
  });

  it("creates a member, who is then signed in", async () => {
    const { store } = setup();
    const s = store();
    await s.restore();
    show(s);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "CREATE A MEMBER" }));
    await user.type(form.getByLabelText("Login"), "dave");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "CREATE MEMBER" }));
    expect(await screen.findByText("dave")).toBeInTheDocument();
    expect(screen.getByText("0 of 1")).toBeInTheDocument();
  });

  it("says why a login is refused", async () => {
    const { server, store } = setup();
    await signInAs(store());
    server.cookie = null;
    const s = store();
    await s.restore();
    show(s);
    const user = userEvent.setup();
    const form = within(screen.getByRole("form", { name: "CREATE A MEMBER" }));
    await user.type(form.getByLabelText("Login"), "carol");
    await user.type(form.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "CREATE MEMBER" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That login is taken.");
  });

  it("a member creates the game account, capped at 9 characters, and sees 1 of 1", async () => {
    const { store } = setup();
    const s = store();
    await signInAs(s);
    show(s);
    expect(screen.getByText("0 of 1")).toBeInTheDocument();
    const user = userEvent.setup();
    const nick = screen.getByLabelText(/Game name/);
    expect(nick).toHaveAttribute("maxlength", "9");
    await user.type(nick, "ABCDEFGHIJKL");
    expect(nick).toHaveValue("ABCDEFGHI");
    await user.type(screen.getByLabelText(/Game account password/), "game-pass-1");
    await user.click(screen.getByRole("button", { name: "CREATE OR CLAIM" }));
    expect(await screen.findByText("Game account ABCDEFGHI created.")).toBeInTheDocument();
    // the limit is reached: the form gives way to the nick and "1 of 1"
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CREATE OR CLAIM" })).toBeNull();
    expect(screen.getByText("ABCDEFGHI", { selector: "li" })).toBeInTheDocument();
  });

  it("shows the limit when the server says it is reached", async () => {
    const { server, store } = setup();
    const s = store();
    await signInAs(s);
    server.maxGameAccounts = 0; // lowered by the operator after the page loaded
    show(s);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Game name/), "Late");
    await user.type(screen.getByLabelText(/Game account password/), "game-pass-1");
    await user.click(screen.getByRole("button", { name: "CREATE OR CLAIM" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("all the game accounts");
  });

  it("claims an existing game account; a wrong password is said and nothing is linked", async () => {
    const { store } = setup();
    const s = store();
    await signInAs(s);
    show(s);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Game name/), "Taken");
    await user.type(screen.getByLabelText(/Game account password/), "wrong-pass-1");
    await user.click(screen.getByRole("button", { name: "CREATE OR CLAIM" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That is not the password of that game account.",
    );
    expect(screen.getByText("0 of 1")).toBeInTheDocument();
    // the right one claims it
    const password = screen.getByLabelText(/Game account password/);
    await user.clear(password);
    await user.type(password, "wolpassword");
    await user.click(screen.getByRole("button", { name: "CREATE OR CLAIM" }));
    expect(await screen.findByText("Game account Taken is now yours.")).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("signs out: back to the forms, the cookie gone", async () => {
    const { server, store } = setup();
    const s = store();
    await signInAs(s);
    show(s);
    await userEvent.setup().click(screen.getByRole("button", { name: "SIGN OUT" }));
    expect(await screen.findByRole("form", { name: "SIGN IN" })).toBeInTheDocument();
    expect(server.cookie).toBeNull();
    expect(server.log().at(-1)).toBe("POST /v1/auth/logout");
  });

  it("signs out everywhere", async () => {
    const { server, store } = setup();
    const s = store();
    await signInAs(s);
    show(s);
    await userEvent.setup().click(screen.getByRole("button", { name: "SIGN OUT EVERYWHERE" }));
    expect(await screen.findByRole("form", { name: "SIGN IN" })).toBeInTheDocument();
    expect(server.log().at(-1)).toBe("POST /v1/members/logout-everywhere");
  });

  it("restores the member after a reload with one refresh", async () => {
    const { server, store } = setup();
    await signInAs(store());
    server.calls.length = 0;
    const reloaded = store();
    show(reloaded);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    await reloaded.restore();
    expect(await screen.findByRole("button", { name: "SIGN OUT" })).toBeInTheDocument();
    expect(server.log()).toEqual(["POST /v1/auth/refresh"]);
  });

  it("offline: the launcher stays a guest and says so; TRY AGAIN reconnects", async () => {
    const { server, store } = setup();
    await signInAs(store());
    server.down = true;
    const s = store();
    await s.restore();
    expect(s.getState().status).toBe("offline");
    show(s);
    expect(screen.getByRole("status")).toHaveTextContent("cannot be reached");
    expect(screen.queryByRole("form", { name: "SIGN IN" })).toBeNull();
    server.down = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "TRY AGAIN" }));
    expect(await screen.findByRole("button", { name: "SIGN OUT" })).toBeInTheDocument();
  });

  it("a session the server ended says so and offers the forms again", async () => {
    const { server, store } = setup();
    const s = store();
    await signInAs(s);
    server.expireAccessTokens();
    server.cookie = null;
    show(s);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Game name/), "Late");
    await user.type(screen.getByLabelText(/Game account password/), "game-pass-1");
    await user.click(screen.getByRole("button", { name: "CREATE OR CLAIM" }));
    await waitFor(() => expect(s.getState().status).toBe("guest"));
    expect(await screen.findByText(/Your session ended/)).toBeInTheDocument();
  });
});

describe("Shell identity", () => {
  function shell(store: AccountStore) {
    render(
      <MemoryRouter>
        <Shell
          editions={[]}
          edition={null}
          onEdition={() => {}}
          estimate={async () => ({})}
          accountStore={store}
        >
          <p>content</p>
        </Shell>
      </MemoryRouter>,
    );
  }

  it("says Guest, linking to the account page", async () => {
    const { store } = setup();
    const s = store();
    await s.restore();
    shell(s);
    expect(screen.getByRole("link", { name: "Account: guest" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByText("Guest")).toBeInTheDocument();
  });

  it("says the member and their game name, and changes with the session", async () => {
    const { store } = setup();
    const s = store();
    await signInAs(s);
    shell(s);
    expect(screen.getByRole("link", { name: "Account: carol" })).toBeInTheDocument();
    await s.addGameAccount("Carol", "game-pass-1");
    expect(await screen.findByRole("link", { name: "Account: carol, Carol" })).toHaveAttribute(
      "href",
      "/account",
    );
    await s.signOut();
    expect(await screen.findByText("Guest")).toBeInTheDocument();
  });

  it("offline reads as Guest", async () => {
    const { server, store } = setup();
    server.down = true;
    const s = store();
    await s.restore();
    shell(s);
    expect(screen.getByText("Guest")).toBeInTheDocument();
  });
});
