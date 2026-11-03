import { describe, expect, it } from "vitest";
import {
  introArguments,
  readSkipIntroPreference,
  writeSkipIntroPreference,
} from "./intro-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("skip intro preference", () => {
  it("plays the intro by default", () => {
    const storage = memoryStorage();
    expect(readSkipIntroPreference("slot-1-ra2", storage)).toBe(false);
    expect(introArguments("", "slot-1-ra2", storage)).toEqual(["--intro"]);
  });

  it("keeps the launcher's choice per game", () => {
    const storage = memoryStorage();
    writeSkipIntroPreference("slot-1-ra2", true, storage);
    expect(readSkipIntroPreference("slot-1-ra2", storage)).toBe(true);
    expect(readSkipIntroPreference("slot-1-ra2md", storage)).toBe(false);
    expect(introArguments("", "slot-1-ra2", storage)).toEqual(["--no-intro"]);
    expect(introArguments("", "slot-1-ra2md", storage)).toEqual(["--intro"]);
  });

  it("clears the stored choice when the switch goes back off", () => {
    const storage = memoryStorage();
    writeSkipIntroPreference("slot-1-ra2", true, storage);
    writeSkipIntroPreference("slot-1-ra2", false, storage);
    expect(storage.values.size).toBe(0);
    expect(readSkipIntroPreference("slot-1-ra2", storage)).toBe(false);
  });

  it("lets the URL skip the intro for one launch", () => {
    const storage = memoryStorage();
    for (const value of ["0", "no", "off", "skip", "SKIP"])
      expect(introArguments(`?intro=${value}`, "slot-1-ra2", storage)).toEqual(["--no-intro"]);
    for (const value of ["1", "yes", "on"])
      expect(introArguments(`?intro=${value}`, "slot-1-ra2", storage)).toEqual(["--intro"]);
  });

  it("survives storage that is unavailable", () => {
    expect(readSkipIntroPreference("slot-1-ra2", null)).toBe(false);
    expect(() => writeSkipIntroPreference("slot-1-ra2", true, null)).not.toThrow();
    expect(introArguments("", "slot-1-ra2", null)).toEqual(["--intro"]);
  });
});
