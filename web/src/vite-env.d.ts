/// <reference types="vite/client" />

/** package.json's version, set by vite.config.ts. */
declare const __APP_VERSION__: string;

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
