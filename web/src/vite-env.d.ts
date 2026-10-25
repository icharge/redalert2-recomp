/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" hides the game tray's LAN button; anything else shows it. */
  readonly VITE_SHOW_NETWORK_LAN?: string;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
