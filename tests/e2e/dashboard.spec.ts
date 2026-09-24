import { expect, test, type Page } from "@playwright/test";

async function resetWorkspace(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await expect(page.getByText(/Good (morning|afternoon|evening)\./)).toBeVisible();
}

async function addMajorTask(page: Page, title: string) {
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a commitment" });
  await dialog.getByLabel("What needs doing?").fill(title);
  await dialog.getByRole("button", { name: "Add task" }).click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Close task details" })
    .click();
}

test.describe("Morrow dashboard interactions", () => {
  test("major card body opens details while Done completes and Undo restores", async ({
    page,
  }) => {
    await resetWorkspace(page);

    const openAtlas = page.getByRole("button", {
      name: "Open Prepare the Atlas launch decision",
    });
    await openAtlas.click();
    await expect(
      page.getByRole("dialog", { name: "Prepare the Atlas launch decision" }),
    ).toBeVisible();
    const closeDetails = page
      .getByRole("dialog", { name: "Prepare the Atlas launch decision" })
      .getByRole("button", { name: "Close task details" });
    await expect(closeDetails).toBeFocused();
    await expect(
      page.locator("main#workspace-main").locator(".."),
    ).toHaveAttribute("inert", "");
    await closeDetails.click();
    await expect(openAtlas).toBeFocused();

    await page
      .getByRole("button", {
        name: "Mark Prepare the Atlas launch decision complete",
      })
      .click();
    await expect(page.getByText("Task completed")).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Prepare the Atlas launch decision" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("button", {
        name: "Open Prepare the Atlas launch decision",
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Open Prepare the Atlas launch decision",
      }),
    ).toBeVisible();
  });

  test("Back restores the root Today horizon", async ({ page }) => {
    await resetWorkspace(page);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/horizon=week/);
    await expect(
      page.getByRole("button", { name: "Week", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.history.back());
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("button", { name: "Day", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("Clear filters keeps URL and restored state synchronized", async ({
    page,
  }) => {
    await resetWorkspace(page);
    await page
      .getByRole("navigation", { name: "Work areas" })
      .getByRole("button", { name: /Work/ })
      .click();
    await page
      .getByRole("textbox", { name: "Search work, people, and messages" })
      .fill("no-result-query");
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/area=/);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Everything" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("follow-up completion persists across reload", async ({ page }) => {
    await resetWorkspace(page);
    await page
      .getByRole("button", {
        name: "Mark follow-up with Jordan Blake complete",
      })
      .click();
    await expect(page.getByText("Jordan Blake")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Jordan Blake")).toHaveCount(0);
  });

  test("Plan today opens a working capacity flow", async ({ page }) => {
    await resetWorkspace(page);
    await addMajorTask(page, "Third major outcome");
    await addMajorTask(page, "Fourth major outcome");

    await page.getByRole("button", { name: "Plan today" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose your top three" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Move to Quick actions" })
      .first()
      .click();
    await expect(page.getByText("Moved to Quick actions")).toBeVisible();
    await dialog.getByRole("button", { name: "Done planning" }).click();
    await expect(page.getByRole("button", { name: "Plan today" })).toHaveCount(
      0,
    );
  });

  test("live clock advances the next meeting without reload", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date() });
    await resetWorkspace(page);
    const nextMeeting = page
      .getByRole("article")
      .filter({ hasText: "Next meeting" });
    await expect(nextMeeting).toContainText("Launch decision review");

    await page.clock.fastForward(13 * 60 * 60 * 1000);
    await expect(nextMeeting).toContainText("Northstar renewal follow-up");
  });
});

test.describe("responsive and route gates", () => {
  for (const width of [320, 640, 768, 1024, 1180, 1440]) {
    test(`has no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await resetWorkspace(page);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(
        dimensions.clientWidth,
      );
    });
  }

  test("meaningful visible text is at least 10px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await resetWorkspace(page);
    const undersizedText = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              element.children.length === 0 &&
              Boolean(element.textContent?.trim()) &&
              Number.parseFloat(style.fontSize) < 10
            );
          })
          .map((element) => ({
            text: element.textContent?.trim().slice(0, 40),
            fontSize: getComputedStyle(element).fontSize,
          })),
      );

    expect(await undersizedText()).toEqual([]);
    await page.getByRole("button", { name: "Open source health" }).click();
    expect(await undersizedText()).toEqual([]);
  });

  test("schedule remains readable with WCAG text spacing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetWorkspace(page);
    await page.addStyleTag({
      content: `
        * {
          line-height: 1.5 !important;
          letter-spacing: 0.12em !important;
          word-spacing: 0.16em !important;
        }
      `,
    });

    const scheduleTitle = page.getByText("Atlas decision · focus block", {
      exact: true,
    });
    await expect(scheduleTitle).toBeVisible();
    expect(
      await scheduleTitle.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });

  test("mobile navigation contains focus and restores it to More", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetWorkspace(page);
    const more = page.getByRole("button", { name: "More" });
    await more.click();
    const drawer = page.getByRole("dialog", {
      name: "Workspace navigation",
    });
    await expect(drawer).toBeVisible();
    const closeNavigation = drawer.getByRole("button", {
      name: "Close navigation",
    });
    await expect(closeNavigation).toBeFocused();

    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(() => {
          const active = document.activeElement;
          const nav = document.querySelector(
            '[aria-label="Workspace navigation"]',
          );
          return Boolean(active && nav?.contains(active));
        }),
      ).toBe(true);
    }

    await closeNavigation.click();
    await expect(more).toBeFocused();
  });

  test("public route gates remain closed", async ({ request }) => {
    await expect((await request.get("/")).status()).toBe(200);
    await expect((await request.get("/api/connectors")).status()).toBe(200);
    await expect(
      (await request.get("/api/connectors/gmail/authorize")).status(),
    ).toBe(503);
    for (const path of [
      "/api/auth/session",
      "/api/connections",
      "/api/integrations",
      "/api/webhooks/duxsoup",
      "/api/demo-login",
    ]) {
      await expect((await request.get(path)).status()).toBe(404);
    }
  });
});
