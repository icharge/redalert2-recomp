import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  readWelcomeDismissed,
  showWelcome,
  writeWelcomeDismissed,
} from "../../storage/welcome-preferences";
import { WELCOME_REDIRECT, WelcomeScreen } from "./WelcomeScreen";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function routes(installed: boolean, state?: unknown) {
  return (
    <MemoryRouter initialEntries={[{ pathname: "/welcome", state }]}>
      <Routes>
        <Route path="/welcome" element={<WelcomeScreen installed={installed} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
}

function show(installed = false, state?: unknown) {
  return render(routes(installed, state));
}

afterEach(() => localStorage.clear());

describe("WelcomeScreen", () => {
  it("says what this is and that the player brings their own game", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/IN YOUR BROWSER/);
    const byog = screen.getByRole("region", { name: "BRING YOUR OWN GAME" });
    expect(byog).toHaveTextContent(/Nothing of the game is downloaded from this site/);
    expect(byog).toHaveTextContent(/never uploaded/);
  });

  it("links to the install guide, and to the install screen while nothing is installed", () => {
    show();
    expect(screen.getByRole("link", { name: "READ THE INSTALL GUIDE" })).toHaveAttribute(
      "href",
      "/install/guide",
    );
    expect(screen.getByRole("link", { name: "I HAVE MY GAME FOLDER" })).toHaveAttribute(
      "href",
      "/import",
    );
  });

  it("a guest with nothing installed goes to the guide; with a game, to PLAY", () => {
    show();
    const guest = within(screen.getByRole("article", { name: "GUEST" }));
    expect(guest.getByRole("link", { name: "PLAY AS GUEST" })).toHaveAttribute(
      "href",
      "/install/guide",
    );
  });

  it("with a game installed the guest goes to PLAY and there is no install link", () => {
    show(true);
    expect(screen.getByRole("link", { name: "PLAY AS GUEST" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "I HAVE MY GAME FOLDER" })).toBeNull();
  });

  it("SIGN IN goes to the account page", () => {
    show();
    const member = within(screen.getByRole("article", { name: "MEMBER" }));
    expect(member.getByRole("link", { name: "SIGN IN" })).toHaveAttribute("href", "/account");
  });

  it("DON'T SHOW THIS AGAIN remembers the dismissal and goes to PLAY", async () => {
    show();
    expect(readWelcomeDismissed()).toBe(false);
    await userEvent.setup().click(screen.getByRole("button", { name: "DON'T SHOW THIS AGAIN" }));
    expect(readWelcomeDismissed()).toBe(true);
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });
});

describe("the redirect from /", () => {
  it("goes back to PLAY once an install shows up", () => {
    const view = show(false, WELCOME_REDIRECT);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    view.rerender(routes(true, WELCOME_REDIRECT));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });

  it("a visit the player asked for stays, installed or not", () => {
    show(true);
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
