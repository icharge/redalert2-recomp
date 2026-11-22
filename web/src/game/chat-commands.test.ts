import { describe, expect, it } from "vitest";
import { expandChatCommand, replyWithoutTarget } from "./chat-commands";

describe("expandChatCommand", () => {
  it("writes /p out as /page, keeping the rest", () => {
    expect(expandChatCommand("/p bob hello there")).toBe("/page bob hello there");
    expect(expandChatCommand("/P bob hi")).toBe("/page bob hi");
    expect(expandChatCommand("/p")).toBe("/page");
  });

  it("writes /m, /msg and /pm out as /page too", () => {
    expect(expandChatCommand("/m bob hi")).toBe("/page bob hi");
    expect(expandChatCommand("/msg bob hi")).toBe("/page bob hi");
    expect(expandChatCommand("/PM bob hi")).toBe("/page bob hi");
    expect(expandChatCommand("/me waves")).toBe("/me waves");
    expect(expandChatCommand("/motd")).toBe("/motd");
  });

  it("leaves other lines and commands alone", () => {
    expect(expandChatCommand("/page bob hi")).toBe("/page bob hi");
    expect(expandChatCommand("/play now")).toBe("/play now");
    expect(expandChatCommand("/r thanks")).toBe("/r thanks"); // nobody to answer: the game's own
    expect(expandChatCommand("p bob hi")).toBe("p bob hi");
    expect(expandChatCommand("hello /p bob")).toBe("hello /p bob");
  });

  it("answers /r and /reply to the last player who whispered, as /page", () => {
    expect(expandChatCommand("/r thanks", "Bob")).toBe("/page Bob thanks");
    expect(expandChatCommand("/REPLY ok then", "Bob")).toBe("/page Bob ok then");
    expect(expandChatCommand("/r", "Bob")).toBe("/page Bob");
    expect(expandChatCommand("/rr hi", "Bob")).toBe("/rr hi");
    expect(expandChatCommand("/m Ann hi", "Bob")).toBe("/page Ann hi");
  });

  it("knows /r with nobody to answer", () => {
    expect(replyWithoutTarget("/r hi", null)).toBe(true);
    expect(replyWithoutTarget("/Reply", null)).toBe(true);
    expect(replyWithoutTarget("/r hi", "Bob")).toBe(false);
    expect(replyWithoutTarget("/rr hi", null)).toBe(false);
    expect(replyWithoutTarget("hello", null)).toBe(false);
  });
});
