import { expect, test } from "@playwright/test";

// The Vite dev server does not send Caddy's headers, so these tests run only against a preview.
test.skip(
  process.env.E2E_BASE_URL === undefined,
  "Caddy sets the cache headers: set E2E_BASE_URL to the URL of a preview",
);

const NO_CACHE = "no-cache";
const IMMUTABLE = "public, max-age=31536000, immutable";

test("index.html and the routes that fall back to it are revalidated on every load", async ({
  request,
}) => {
  for (const path of ["/", "/index.html", "/usage"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("text/html");
    expect(response.headers()["cache-control"], path).toBe(NO_CACHE);
  }
});

test("the hashed files under /assets/ are cached for a year", async ({ request }) => {
  const index = await (await request.get("/")).text();
  const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) {
    const response = await request.get(asset ?? "");
    expect(response.status(), asset).toBe(200);
    expect(response.headers()["cache-control"], asset).toBe(IMMUTABLE);
  }
});

test("a missing file under /assets/ is not cached as immutable", async ({ request }) => {
  const response = await request.get("/assets/missing-0000.js");
  expect(response.headers()["cache-control"]).toBe(NO_CACHE);
});

test("the security headers stay on the cached responses", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["content-security-policy"]).toContain("default-src 'none'");
});

test("an API response has no cache header from the web server", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).not.toBe(IMMUTABLE);
});
