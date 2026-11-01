import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
});

test("validates input, persists completion and supports undo", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const input = page.getByRole("textbox", { name: "New task" });
  const add = page.getByRole("button", { name: "Add", exact: true });
  await expect(add).toBeEnabled();
  await expect(page.locator(".task-card")).toHaveCount(0);
  await input.fill("   ");
  await add.click();
  await expect(input).toBeFocused();
  await expect(page.getByRole("alert")).toHaveText("Please enter a task title.");
  await input.fill("  Browser task  ");
  await add.click();
  await expect(page.locator(".task-title")).toHaveText("Browser task");
  await page.getByRole("button", { name: "Mark Browser task complete" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Mark Browser task incomplete" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Delete Browser task" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".task-card")).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "Undo delete" }).click();
  await expect(page.locator(".task-title")).toHaveText("Browser task");
});

test("two tabs retain concurrent additions and synchronize completion", async ({
  page,
  context,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const other = await context.newPage();
  await other.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await expect(other.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "New task" }).fill("From tab A");
  await other.getByRole("textbox", { name: "New task" }).fill("From tab B");
  await Promise.all([
    page.getByRole("button", { name: "Add", exact: true }).click(),
    other.getByRole("button", { name: "Add", exact: true }).click(),
  ]);
  await expect(page.locator(".task-card")).toHaveCount(2);
  await expect(other.locator(".task-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Mark From tab A complete" }).click();
  await expect(other.getByRole("button", { name: "Mark From tab A incomplete" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await other.reload({ waitUntil: "domcontentloaded" });
  await expect(other.locator(".task-card")).toHaveCount(2);
});

test("mobile long titles remain compact and their dialog scrolls and restores focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const title = "Full long title 🌱 ".repeat(400).trim();
  await page.getByRole("textbox", { name: "New task" }).fill(title);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.locator(".task-card")).toHaveCount(1);
  const geometry = await page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".task-card")!;
    const title = document.querySelector<HTMLElement>(".task-title")!;
    const shader = document.querySelector<HTMLElement>(".shader-spot")!;
    return {
      height: row.getBoundingClientRect().height,
      titleRight: title.getBoundingClientRect().right,
      shaderLeft: shader.getBoundingClientRect().left,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(geometry.height).toBe(86);
  expect(geometry.titleRight).toBeLessThan(geometry.shaderLeft);
  expect(geometry.horizontalOverflow).toBe(false);
  const opener = page.getByRole("button", { name: /^Open full task:/ });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Task details" });
  await expect(dialog.locator(".task-detail-body p")).toHaveText(title);
  await expect(dialog.locator("canvas")).toHaveCount(0);
  expect(
    await dialog
      .locator(".task-detail-body")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("storage failures stay visible outside cards", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toHaveCount(1);
  for (const title of ["Unsaved A", "Unsaved B"]) {
    await page.getByRole("textbox", { name: "New task" }).fill(title);
    await page.getByRole("button", { name: "Add", exact: true }).click();
  }
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.locator(".task-card [role=alert]")).toHaveCount(0);
  await expect(page.locator(".task-title")).toHaveText(["Unsaved A", "Unsaved B"]);
});

test("every shader stays painted in an 80-task list with one context", async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    const original = Reflect.get(
      HTMLCanvasElement.prototype,
      "getContext",
    ) as typeof HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet<HTMLCanvasElement>();
    Object.assign(window, { auditContexts: 0 });
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      options?: unknown,
    ) {
      const value = Reflect.apply(original, this, [kind, options]);
      if ((kind === "webgl" || kind === "webgl2") && value && !seen.has(this)) {
        seen.add(this);
        const target = window as typeof window & { auditContexts: number };
        target.auditContexts++;
      }
      return value;
    } as typeof original;
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const input = page.getByRole("textbox", { name: "New task" });
  const add = page.getByRole("button", { name: "Add", exact: true });
  for (let index = 0; index < 80; index++) {
    await input.fill(`Shader task ${index + 1}`);
    await add.click();
  }
  await expect(page.locator(".shader-spot canvas")).toHaveCount(80);
  const painted = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLCanvasElement>(".shader-spot canvas")).every(
        (canvas) => {
          if (canvas.width <= 1 || canvas.height <= 1) return false;
          const pixels = canvas
            .getContext("2d")!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          return pixels.some((value, index) => index % 4 !== 3 && value > 0);
        },
      ),
    );
  await expect.poll(painted).toBe(true);
  await page.locator(".task-card").last().scrollIntoViewIfNeeded();
  await expect.poll(painted).toBe(true);
  await page.locator(".task-card").first().scrollIntoViewIfNeeded();
  await expect.poll(painted).toBe(true);
  expect(
    await page.evaluate(() => (window as typeof window & { auditContexts: number }).auditContexts),
  ).toBe(1);
});
