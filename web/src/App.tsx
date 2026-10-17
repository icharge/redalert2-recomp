import { Theme } from "@radix-ui/themes";
import { useState } from "react";
import { BrowserCheck } from "./components/BrowserCheck";
import { checkBrowser, missingRequired } from "./components/features";
import { Play } from "./screens/Play";

type Screen = "check" | "play";

/**
 * The theme, and one screen at a time, chosen by state (no routing). Import and Library
 * join Browser check and Play in stage 6.
 */
export function App() {
  const [requirements] = useState(checkBrowser);
  const screen: Screen = missingRequired(requirements).length > 0 ? "check" : "play";
  return (
    <Theme appearance="dark" accentColor="red" grayColor="slate" radius="small">
      {screen === "check" ? <BrowserCheck requirements={requirements} /> : <Play />}
    </Theme>
  );
}
