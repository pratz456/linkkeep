import { afterEach, describe, expect, it, vi } from "vitest";

describe("personal local connector sync", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    const globalDatabase = globalThis as typeof globalThis & {
      morrowPglite?: { close: () => Promise<void> };
    };
    await globalDatabase.morrowPglite?.close();
    delete globalDatabase.morrowPglite;
    vi.resetModules();
  });

  it("stores a bounded Notion page as a real local workspace task", async () => {
    vi.stubEnv("WORKLIFE_LOCAL_MODE", "true");
    vi.stubEnv("DATABASE_URL", "pglite:memory");
    vi.stubEnv(
      "CONNECTOR_ENCRYPTION_KEY",
      Buffer.alloc(32, 7).toString("base64"),
    );
    vi.stubEnv("WORKLIFE_NOTION_CLIENT_ID", "notion-client");
    vi.stubEnv("WORKLIFE_NOTION_CLIENT_SECRET", "notion-secret");
    vi.stubEnv("WORKLIFE_NOTION_VERSION", "2022-06-28");

    const editedAt = new Date().toISOString();
    const fetchMock = vi.fn(async () => {
      return Response.json({
        results: [
          {
            id: "page-123",
            object: "page",
            last_edited_time: editedAt,
            url: "https://www.notion.so/page-123",
            properties: {
              Name: {
                type: "title",
                title: [{ plain_text: "Project brief" }],
              },
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [{ ensureWorkspace, saveConnectorAccount }, { encryptSecret }] =
      await Promise.all([
        import("@/lib/connectors/store"),
        import("@/lib/connectors/security"),
      ]);
    await ensureWorkspace("workspace-local-test");
    await saveConnectorAccount({
      workspaceId: "workspace-local-test",
      provider: "notion",
      externalAccountId: "notion-workspace",
      accountLabel: "Personal Notion",
      accessTokenEncrypted: encryptSecret(
        "notion-access-token",
        process.env.CONNECTOR_ENCRYPTION_KEY!,
      ),
      refreshTokenEncrypted: null,
      tokenType: "bearer",
      scope: null,
      expiresAt: null,
      metadataJson: "{}",
    });

    const [{ mergeSyncedWorkspace, syncLocalConnectors }, { createDemoWorkspace }] =
      await Promise.all([
        import("@/lib/connectors/local-sync"),
        import("@/lib/workspace/demo-data"),
      ]);
    const outcomes = await syncLocalConnectors("workspace-local-test", "notion");
    const snapshot = await mergeSyncedWorkspace(
      "workspace-local-test",
      createDemoWorkspace(),
    );

    expect(outcomes).toEqual([
      { provider: "notion", ok: true, processed: 1 },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(snapshot.isSample).toBe(false);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]).toMatchObject({
      id: "notion:page-123",
      title: "Review Project brief",
      sourceIds: ["notion"],
      sourceUrl: "https://www.notion.so/page-123",
      isSample: false,
    });
  }, 15_000);
});
