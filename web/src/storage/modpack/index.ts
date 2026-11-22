// Reading an XCC mod pack (docs/mod-packs.md). The screen imports this entry
// point; everything under it is an independent MIT implementation.

export { buildPackSource, isPackName, sourceFromFiles, unwrapExe, type PackSource } from "./load";
export { createBaseData, opfsInstallFiles } from "./base";
export type { BaseData, BuiltPack } from "./build";
export type { ModEntry, ModGame, ModOptions, ModPack } from "./model";
