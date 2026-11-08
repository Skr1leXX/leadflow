import { test as base, expect } from "@playwright/test";
import { randomIp } from "./helpers";

/** Every browser context gets its own client address, so the form's rate limit never couples unrelated tests. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": randomIp() });
    await provide(context);
  },
});

export { expect };
