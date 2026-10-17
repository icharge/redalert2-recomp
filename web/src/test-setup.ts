import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest's globals are off, so Testing Library does not clean up after a test by itself
afterEach(cleanup);
