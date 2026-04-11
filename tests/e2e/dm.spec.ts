import { test, expect, expectNoPageErrors } from "./fixtures/auth";

const API_URL = process.env.PLAYWRIGHT_API_URL || "http://localhost:3001";

test.describe("Direct Messages", () => {
  test("user can start a conversation and send a message", async ({
    authenticatedPage: page,
  }) => {
    // Get the second test user's ID via API
    const ctx = await page.context();
    const meRes = await ctx.request.get(`${API_URL}/api/v1/auth/me`);
    expect(meRes.ok()).toBeTruthy();

    // Search for the second test user
    const searchRes = await ctx.request.get(
      `${API_URL}/api/v1/search/users?q=e2e_testuser2&limit=1`,
    );
    expect(searchRes.ok()).toBeTruthy();
    const searchData = await searchRes.json();
    const users = searchData.data?.items ?? searchData.data ?? [];
    expect(users.length).toBeGreaterThan(0);
    const otherUserId = users[0].id;

    // Start a plaintext DM conversation via the v2 conversations endpoint.
    // E2EE conversations require device registration + per-device ciphertexts;
    // this smoke test exercises the basic messaging flow without crypto setup.
    const dmRes = await ctx.request.post(`${API_URL}/api/v1/conversations`, {
      data: {
        conversationType: "direct",
        encryption: "none",
        members: [otherUserId],
      },
    });
    expect(dmRes.ok()).toBeTruthy();
    const dmData = await dmRes.json();
    const conversationId = dmData.data?.id;
    expect(conversationId).toBeTruthy();

    // Send a plaintext message via the v2 messages endpoint.
    const msgRes = await ctx.request.post(
      `${API_URL}/api/v1/conversations/${conversationId}/messages`,
      { data: { content: "Hello from e2e test!" } },
    );
    expect(msgRes.ok()).toBeTruthy();

    const conversationLoaded = page.waitForResponse((res) => {
      const url = res.url();
      return (
        res.request().method() === "GET" &&
        res.ok() &&
        url.includes(`/api/v1/conversations/${conversationId}`)
      );
    });

    // Navigate to the conversation page and verify the message renders
    await page.goto(`/messages/${conversationId}`);
    await expect(page.locator("main")).toBeVisible();
    await conversationLoaded;

    // The message text should appear on the page
    await expect(
      page.getByText("Hello from e2e test!", { exact: true }),
    ).toBeVisible({
      timeout: 30000,
    });

    expectNoPageErrors(page);
  });

  test("messages page loads for authenticated user", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/messages");
    await expect(page).toHaveURL(/messages/);
    await expect(page.locator("main")).toBeVisible();
    expectNoPageErrors(page);
  });
});
