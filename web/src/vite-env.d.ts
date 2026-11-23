/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "false" turns LAN play off for everyone (config.ts); anything else keeps it. */
  readonly VITE_SHOW_NETWORK_LAN?: string;
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
