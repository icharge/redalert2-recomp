import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Manifest } from "../storage/manifest";
import {
  DEFAULT_SOUND_PREFERENCES,
  loadSoundPreferences,
  saveSoundPreference,
} from "./sound-preferences";

const fresh = () => {
  const factory = new IDBFactory();
  return () => Manifest.open(factory);
};

describe("the sound preferences", () => {
  it("are the defaults until the player chooses", async () => {
    expect(await loadSoundPreferences(fresh())).toEqual(DEFAULT_SOUND_PREFERENCES);
    expect(DEFAULT_SOUND_PREFERENCES).toEqual({ muteOnBlur: false, menuMusic: true });
  });

  it("come back as chosen, each on its own", async () => {
    const open = fresh();
    await saveSoundPreference("muteOnBlur", true, open);
    expect(await loadSoundPreferences(open)).toEqual({ muteOnBlur: true, menuMusic: true });
    await saveSoundPreference("menuMusic", false, open);
    expect(await loadSoundPreferences(open)).toEqual({ muteOnBlur: true, menuMusic: false });
    await saveSoundPreference("muteOnBlur", false, open);
    expect(await loadSoundPreferences(open)).toEqual({ muteOnBlur: false, menuMusic: false });
  });

  it("fall back to the default for what is kept but not a yes/no, or when storage is not there", async () => {
    const open = fresh();
    await (await open()).setSetting("muteOnBlur", "yes");
    await (await open()).setSetting("menuMusic", 0);
    expect(await loadSoundPreferences(open)).toEqual(DEFAULT_SOUND_PREFERENCES);
    const broken = () => Promise.reject(new Error("no storage"));
    expect(await loadSoundPreferences(broken)).toEqual(DEFAULT_SOUND_PREFERENCES);
    await expect(saveSoundPreference("muteOnBlur", true, broken)).resolves.toBeUndefined();
  });
});
