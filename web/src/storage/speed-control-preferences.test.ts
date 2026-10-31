import { describe, expect, it } from "vitest";
import {
  readCampaignSpeedControlPreference,
  speedControlArguments,
  writeCampaignSpeedControlPreference,
} from "./speed-control-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("campaign speed-control preference", () => {
  it("is off by default", () => {
    const storage = memoryStorage();
    expect(readCampaignSpeedControlPreference("slot-1-ra2", storage)).toBe(false);
    expect(speedControlArguments("", "slot-1-ra2", storage)).toEqual([]);
  });

  it("keeps the launcher's choice per game", () => {
    const storage = memoryStorage();
    writeCampaignSpeedControlPreference("slot-1-ra2", true, storage);
    expect(readCampaignSpeedControlPreference("slot-1-ra2", storage)).toBe(true);
    expect(readCampaignSpeedControlPreference("slot-1-ra2md", storage)).toBe(false);
    expect(speedControlArguments("", "slot-1-ra2", storage)).toEqual(["-SPEEDCONTROL"]);
    expect(speedControlArguments("", "slot-1-ra2md", storage)).toEqual([]);
  });

  it("clears the stored choice when the switch goes back off", () => {
    const storage = memoryStorage();
    writeCampaignSpeedControlPreference("slot-1-ra2", true, storage);
    writeCampaignSpeedControlPreference("slot-1-ra2", false, storage);
    expect(storage.values.size).toBe(0);
    expect(readCampaignSpeedControlPreference("slot-1-ra2", storage)).toBe(false);
  });

  it("lets the URL override the stored choice for one launch", () => {
    const storage = memoryStorage();
    writeCampaignSpeedControlPreference("slot-1-ra2", true, storage);
    for (const value of ["0", "no", "off"])
      expect(speedControlArguments(`?speedcontrol=${value}`, "slot-1-ra2", storage)).toEqual([]);
    writeCampaignSpeedControlPreference("slot-1-ra2", false, storage);
    for (const value of ["1", "yes", "on"])
      expect(speedControlArguments(`?speedcontrol=${value}`, "slot-1-ra2", storage)).toEqual([
        "-SPEEDCONTROL",
      ]);
  });

  it("survives storage that is unavailable", () => {
    expect(readCampaignSpeedControlPreference("slot-1-ra2", null)).toBe(false);
    expect(() => writeCampaignSpeedControlPreference("slot-1-ra2", true, null)).not.toThrow();
    expect(speedControlArguments("", "slot-1-ra2", null)).toEqual([]);
  });
});
