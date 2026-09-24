import "server-only";

import type { ConnectorAccount } from "@/db/schema";
import {
  normalizeSourceUrl,
  normalizeUntrustedExcerpt,
} from "@/lib/connectors/content-boundary";
import {
  getOAuthProviderConfig,
  isOAuthConnectorId,
  refreshOAuthAccessToken,
  type OAuthConnectorId,
} from "@/lib/connectors/providers";
import { decryptSecret, encryptSecret } from "@/lib/connectors/security";
import {
  listConnectorAccountRecords,
  listWorkspaceConnectorItems,
  markConnectorSynced,
  replaceConnectorItems,
  updateConnectorTokens,
  type ConnectorItemInput,
} from "@/lib/connectors/store";
import type {
  FollowUp,
  ScheduleItem,
  WorkTask,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const SYNC_LOOKBACK_DAYS = 14;

export interface ConnectorSyncOutcome {
  provider: OAuthConnectorId;
  ok: boolean;
  processed: number;
  error?: string;
}

export async function syncLocalConnectors(
  workspaceId: string,
  provider?: OAuthConnectorId,
): Promise<ConnectorSyncOutcome[]> {
  if (process.env.WORKLIFE_LOCAL_MODE !== "true") {
    throw new Error("Local connector sync is disabled.");
  }

  const accounts = await listConnectorAccountRecords(workspaceId);
  const selected = provider
    ? accounts.filter((account) => account.provider === provider)
    : accounts;

  return Promise.all(
    selected.map(async (account) => {
      const accountProvider = account.provider as OAuthConnectorId;
      if (!isOAuthConnectorId(accountProvider)) {
        return {
          provider: accountProvider,
          ok: false,
          processed: 0,
          error: "Unsupported provider.",
        };
      }
      try {
        const accessToken = await getUsableAccessToken(account);
        const items = await fetchConnectorItems(
          account,
          accountProvider,
          accessToken,
        );
        await replaceConnectorItems(account, items);
        await markConnectorSynced(account.id);
        return {
          provider: accountProvider,
          ok: true,
          processed: items.length,
        };
      } catch (error) {
        return {
          provider: accountProvider,
          ok: false,
          processed: 0,
          error: publicSyncError(error),
        };
      }
    }),
  );
}

export async function mergeSyncedWorkspace(
  workspaceId: string,
  fallback: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  const [accounts, rows] = await Promise.all([
    listConnectorAccountRecords(workspaceId),
    listWorkspaceConnectorItems(workspaceId),
  ]);
  const hasCompletedSync = accounts.some((account) => account.lastSyncedAt);
  if (!hasCompletedSync) return fallback;

  const tasks: WorkTask[] = [];
  const schedule: ScheduleItem[] = [];
  const followUps: FollowUp[] = [];

  for (const row of rows) {
    try {
      const value = JSON.parse(row.dataJson) as unknown;
      if (row.itemType === "task" && isWorkTask(value)) tasks.push(value);
      if (row.itemType === "schedule" && isScheduleItem(value)) {
        schedule.push(value);
      }
      if (row.itemType === "follow_up" && isFollowUp(value)) {
        followUps.push(value);
      }
    } catch {
      // Ignore a malformed local cache record instead of breaking the workspace.
    }
  }

  return {
    tasks,
    schedule: schedule.sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    ),
    followUps,
    generatedAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    isSample: false,
  };
}

async function getUsableAccessToken(account: ConnectorAccount) {
  const encryptionKey = process.env.CONNECTOR_ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    throw new Error("Local connector encryption is not configured.");
  }

  const accessToken = decryptSecret(
    account.accessTokenEncrypted,
    encryptionKey,
  );
  const expiresAt = account.expiresAt
    ? new Date(account.expiresAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (expiresAt > Date.now() + 5 * 60_000) return accessToken;

  if (!account.refreshTokenEncrypted) {
    throw new Error("Reconnect this source to renew access.");
  }
  const provider = account.provider as OAuthConnectorId;
  const config = getOAuthProviderConfig(provider, process.env);
  if (!config) {
    throw new Error("Provider credentials are no longer configured.");
  }
  const refreshToken = decryptSecret(
    account.refreshTokenEncrypted,
    encryptionKey,
  );
  const refreshed = await refreshOAuthAccessToken(config, refreshToken);
  await updateConnectorTokens(account.id, {
    accessTokenEncrypted: encryptSecret(
      refreshed.accessToken,
      encryptionKey,
    ),
    refreshTokenEncrypted: refreshed.refreshToken
      ? encryptSecret(refreshed.refreshToken, encryptionKey)
      : undefined,
    expiresAt: refreshed.expiresAt,
    scope: refreshed.scope,
  });
  return refreshed.accessToken;
}

async function fetchConnectorItems(
  account: ConnectorAccount,
  provider: OAuthConnectorId,
  accessToken: string,
) {
  switch (provider) {
    case "gmail":
      return fetchGmailItems(account, accessToken);
    case "calendar":
      return fetchCalendarItems(account, accessToken);
    case "drive":
      return fetchDriveItems(account, accessToken);
    case "slack":
      return fetchSlackItems(account, accessToken);
    case "notion":
      return fetchNotionItems(account, accessToken);
    default:
      throw new Error("Unsupported local connector.");
  }
}

async function fetchGmailItems(
  account: ConnectorAccount,
  accessToken: string,
): Promise<ConnectorItemInput[]> {
  const list = await providerJson(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20",
    accessToken,
  );
  const messages = arrayOfRecords(list.messages).slice(0, 20);
  const details = await Promise.all(
    messages.map(async (message) => {
      const id = stringValue(message.id);
      if (!id) return null;
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`,
      );
      url.searchParams.set("format", "metadata");
      for (const header of ["Subject", "From", "Date"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      return providerJson(url.toString(), accessToken).catch(() => null);
    }),
  );

  return details.flatMap((message) => {
    if (!message) return [];
    const id = stringValue(message.id);
    if (!id) return [];
    const labels = stringArray(message.labelIds);
    if (!labels.includes("UNREAD") && !labels.includes("IMPORTANT")) return [];
    const headers = arrayOfRecords(asRecord(message.payload)?.headers);
    const subject = headerValue(headers, "Subject") || "Email without a subject";
    const sender = headerValue(headers, "From") || "Unknown sender";
    const occurredAt = timestampFromMilliseconds(message.internalDate);
    const excerpt = normalizeUntrustedExcerpt({
      workspaceId: account.workspaceId,
      sourceArtifactId: id,
      provider: "gmail",
      text: stringValue(message.snippet) || `Message from ${sender}`,
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${id}`,
      observedAt: occurredAt,
      maxLength: 420,
    });
    const dueAt = atLocalHour(
      new Date(),
      labels.includes("UNREAD") ? 0 : 1,
      17,
    );
    const task: WorkTask = {
      id: `gmail:${id}`,
      title: cleanTitle(subject, 140),
      project: "Email",
      area: "Work",
      importance: labels.includes("IMPORTANT") ? "major" : "minor",
      status: "open",
      dueAt,
      estimateMinutes: 15,
      sourceIds: ["gmail"],
      signals: [
        {
          id: `gmail-signal:${id}`,
          connectorId: "gmail",
          label: cleanTitle(sender, 100),
          detail: excerpt.plainText,
          occurredAt,
        },
      ],
      rationale: labels.includes("UNREAD")
        ? "An unread email may need a response."
        : "Gmail marked this message important.",
      reasonCodes: ["provider_attention", "recent_context"],
      sourceUrl: excerpt.sourceUrl,
      priority: {
        deadlineKind: "inferred",
        deadlineConfidence: 0.6,
        impactLevel: labels.includes("IMPORTANT") ? 3 : 1,
        impactConfidence: 0.7,
        commitmentKind: labels.includes("IMPORTANT") ? "flagged" : "inferred",
        commitmentConfidence: 0.65,
        lastEvidenceAt: occurredAt,
      },
      createdAt: occurredAt,
      isSample: false,
    };
    return [
      itemInput(id, "task", task, occurredAt),
    ];
  });
}

async function fetchCalendarItems(
  account: ConnectorAccount,
  accessToken: string,
): Promise<ConnectorItemInput[]> {
  const now = new Date();
  const through = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", through.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "75");
  const payload = await providerJson(url.toString(), accessToken);
  const events = arrayOfRecords(payload.items)
    .filter((event) => stringValue(event.status) !== "cancelled")
    .flatMap((event) => {
      const id = stringValue(event.id);
      const start = eventDate(asRecord(event.start));
      const end = eventDate(asRecord(event.end));
      if (!id || !start || !end) return [];
      const title = cleanTitle(stringValue(event.summary) || "Busy", 140);
      const lowerTitle = title.toLowerCase();
      const attendees = arrayOfRecords(event.attendees);
      const description = normalizeUntrustedExcerpt({
        workspaceId: account.workspaceId,
        sourceArtifactId: id,
        provider: "calendar",
        text: stringValue(event.description) || "",
        sourceUrl: stringValue(event.htmlLink),
        observedAt: start,
        maxLength: 180,
      });
      const item: ScheduleItem = {
        id: `calendar:${id}`,
        title,
        startAt: start,
        endAt: end,
        kind: /focus|deep work|heads down/.test(lowerTitle)
          ? "focus"
          : /lunch|gym|walk|personal|doctor|dentist/.test(lowerTitle)
            ? "personal"
            : "meeting",
        sourceId: "calendar",
        attendees: attendees.length || undefined,
        location: cleanOptional(stringValue(event.location), 120),
        joinUrl: calendarJoinUrl(event),
        preparationNote: description.plainText || null,
        conflictState: "none",
        isSample: false,
      };
      return [itemInput(id, "schedule", item, stringValue(event.updated))];
    });

  return addCalendarConflicts(events);
}

async function fetchDriveItems(
  account: ConnectorAccount,
  accessToken: string,
): Promise<ConnectorItemInput[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set(
    "fields",
    "files(id,name,mimeType,modifiedTime,webViewLink,trashed)",
  );
  const payload = await providerJson(url.toString(), accessToken);
  const cutoff = Date.now() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return arrayOfRecords(payload.files).flatMap((file) => {
    const id = stringValue(file.id);
    const modifiedAt = stringValue(file.modifiedTime);
    if (
      !id ||
      !modifiedAt ||
      file.trashed === true ||
      new Date(modifiedAt).getTime() < cutoff
    ) {
      return [];
    }
    const title = cleanTitle(stringValue(file.name) || "Untitled file", 140);
    const task: WorkTask = {
      id: `drive:${id}`,
      title: `Review ${title}`,
      project: "Drive",
      area: "Work",
      importance: "minor",
      status: "open",
      dueAt: atLocalHour(new Date(), 5, 17),
      estimateMinutes: 15,
      sourceIds: ["drive"],
      signals: [
        {
          id: `drive-signal:${id}`,
          connectorId: "drive",
          label: "Recently changed file",
          detail: `${title} changed ${relativeDateLabel(modifiedAt)}.`,
          occurredAt: modifiedAt,
        },
      ],
      rationale: "A recently changed file may need review.",
      reasonCodes: ["recent_context"],
      sourceUrl: normalizeSourceUrl(stringValue(file.webViewLink)),
      priority: {
        deadlineKind: "inferred",
        deadlineConfidence: 0.35,
        impactLevel: 1,
        impactConfidence: 0.4,
        commitmentKind: "inferred",
        commitmentConfidence: 0.4,
        lastEvidenceAt: modifiedAt,
      },
      createdAt: modifiedAt,
      isSample: false,
    };
    return [itemInput(id, "task", task, modifiedAt)];
  });
}

async function fetchSlackItems(
  account: ConnectorAccount,
  accessToken: string,
): Promise<ConnectorItemInput[]> {
  const metadata = parseRecord(account.metadataJson);
  const userId = stringValue(metadata.userId);
  if (!userId) return [];

  const [conversationsPayload, usersPayload] = await Promise.all([
    slackJson(
      "https://slack.com/api/conversations.list?types=public_channel%2Cprivate_channel&exclude_archived=true&limit=100",
      accessToken,
    ),
    slackJson("https://slack.com/api/users.list?limit=200", accessToken),
  ]);
  const users = new Map(
    arrayOfRecords(usersPayload.members).flatMap((user) => {
      const id = stringValue(user.id);
      const profile = asRecord(user.profile);
      const name =
        stringValue(profile?.display_name) ||
        stringValue(profile?.real_name) ||
        stringValue(user.name);
      return id && name ? [[id, cleanTitle(name, 80)] as const] : [];
    }),
  );
  const channels = arrayOfRecords(conversationsPayload.channels)
    .filter((channel) => channel.is_member === true)
    .slice(0, 20);
  const history = await Promise.all(
    channels.map(async (channel) => {
      const id = stringValue(channel.id);
      if (!id) return { channel, messages: [] };
      const url = new URL("https://slack.com/api/conversations.history");
      url.searchParams.set("channel", id);
      url.searchParams.set("limit", "30");
      const payload = await slackJson(url.toString(), accessToken).catch(
        () => ({ messages: [] }),
      );
      return { channel, messages: arrayOfRecords(payload.messages) };
    }),
  );
  const cutoffSeconds =
    Date.now() / 1000 - SYNC_LOOKBACK_DAYS * 24 * 60 * 60;

  return history.flatMap(({ channel, messages }) => {
    const channelId = stringValue(channel.id);
    const channelName = stringValue(channel.name) || "selected channel";
    if (!channelId) return [];
    return messages.flatMap((message) => {
      const ts = stringValue(message.ts);
      const text = stringValue(message.text);
      if (
        !ts ||
        !text ||
        Number(ts) < cutoffSeconds ||
        !text.includes(`<@${userId}>`)
      ) {
        return [];
      }
      const senderId = stringValue(message.user);
      const sender = senderId ? users.get(senderId) : null;
      const occurredAt = slackTimestamp(ts);
      const excerpt = normalizeUntrustedExcerpt({
        workspaceId: account.workspaceId,
        sourceArtifactId: `${channelId}:${ts}`,
        provider: "slack",
        text,
        observedAt: occurredAt,
        maxLength: 420,
      });
      const task: WorkTask = {
        id: `slack:${channelId}:${ts}`,
        title: cleanTitle(
          excerpt.plainText.replace(`<@${userId}>`, "").trim() ||
            `Reply in #${channelName}`,
          140,
        ),
        project: `#${cleanTitle(channelName, 70)}`,
        area: "Work",
        importance: "minor",
        status: "open",
        dueAt: atLocalHour(new Date(), 0, 17),
        estimateMinutes: 10,
        sourceIds: ["slack"],
        signals: [
          {
            id: `slack-signal:${channelId}:${ts}`,
            connectorId: "slack",
            label: sender ? `${sender} mentioned you` : "Slack mention",
            detail: excerpt.plainText,
            occurredAt,
          },
        ],
        rationale: "A recent Slack mention may need a response.",
        reasonCodes: ["direct_mention", "recent_context"],
        sourceUrl: null,
        priority: {
          deadlineKind: "inferred",
          deadlineConfidence: 0.55,
          impactLevel: 1,
          impactConfidence: 0.5,
          commitmentKind: "assignment",
          commitmentConfidence: 0.75,
          lastEvidenceAt: occurredAt,
        },
        createdAt: occurredAt,
        isSample: false,
      };
      return [
        itemInput(`${channelId}:${ts}`, "task", task, occurredAt),
      ];
    });
  });
}

async function fetchNotionItems(
  account: ConnectorAccount,
  accessToken: string,
): Promise<ConnectorItemInput[]> {
  const notionVersion =
    process.env.WORKLIFE_NOTION_VERSION?.trim() || "2022-06-28";
  const payload = await providerJson(
    "https://api.notion.com/v1/search",
    accessToken,
    {
      method: "POST",
      headers: {
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 30,
      }),
    },
  );
  const cutoff = Date.now() - SYNC_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return arrayOfRecords(payload.results).flatMap((page) => {
    const id = stringValue(page.id);
    const editedAt = stringValue(page.last_edited_time);
    if (!id || !editedAt || new Date(editedAt).getTime() < cutoff) return [];
    const title = notionPageTitle(page);
    const task: WorkTask = {
      id: `notion:${id}`,
      title: `Review ${title}`,
      project: "Notion",
      area: "Work",
      importance: "minor",
      status: "open",
      dueAt: atLocalHour(new Date(), 4, 17),
      estimateMinutes: 20,
      sourceIds: ["notion"],
      signals: [
        {
          id: `notion-signal:${id}`,
          connectorId: "notion",
          label: "Recently edited page",
          detail: `${title} changed ${relativeDateLabel(editedAt)}.`,
          occurredAt: editedAt,
        },
      ],
      rationale: "A recently edited shared page may need review.",
      reasonCodes: ["recent_context"],
      sourceUrl: normalizeSourceUrl(stringValue(page.url)),
      priority: {
        deadlineKind: "inferred",
        deadlineConfidence: 0.35,
        impactLevel: 1,
        impactConfidence: 0.4,
        commitmentKind: "inferred",
        commitmentConfidence: 0.4,
        lastEvidenceAt: editedAt,
      },
      createdAt: editedAt,
      isSample: false,
    };
    return [itemInput(id, "task", task, editedAt)];
  });
}

async function providerJson(
  url: string,
  accessToken: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
      body: init.body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
      throw new Error("Provider response exceeded the local safety limit.");
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error("Provider response exceeded the local safety limit.");
    }
    let payload: Record<string, unknown>;
    try {
      payload = asRecord(JSON.parse(text)) ?? {};
    } catch {
      throw new Error("Provider returned invalid JSON.");
    }
    if (!response.ok) {
      throw new Error(`Provider request failed (${response.status}).`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function slackJson(url: string, accessToken: string) {
  const payload = await providerJson(url, accessToken);
  if (payload.ok !== true) {
    throw new Error(
      `Slack request failed: ${stringValue(payload.error) || "unknown_error"}`,
    );
  }
  return payload;
}

function itemInput(
  externalId: string,
  itemType: ConnectorItemInput["itemType"],
  data: WorkTask | ScheduleItem | FollowUp,
  sourceUpdatedAt: string | null,
): ConnectorItemInput {
  return {
    externalId,
    itemType,
    dataJson: JSON.stringify(data),
    sourceUpdatedAt:
      sourceUpdatedAt && !Number.isNaN(new Date(sourceUpdatedAt).getTime())
        ? new Date(sourceUpdatedAt).toISOString()
        : null,
  };
}

function addCalendarConflicts(items: ConnectorItemInput[]) {
  const schedules = items
    .map((item) => JSON.parse(item.dataJson) as ScheduleItem)
    .sort(
      (a, b) =>
        new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  for (let index = 0; index < schedules.length; index += 1) {
    const current = schedules[index];
    const previous = schedules[index - 1];
    if (!previous) continue;
    const previousEnd = new Date(previous.endAt).getTime();
    const currentStart = new Date(current.startAt).getTime();
    current.conflictState =
      previousEnd > currentStart
        ? "overlap"
        : previousEnd === currentStart
          ? "back_to_back"
          : "none";
  }
  return items.map((item) => {
    const schedule = schedules.find(
      (candidate) =>
        candidate.id === (JSON.parse(item.dataJson) as ScheduleItem).id,
    );
    return schedule ? { ...item, dataJson: JSON.stringify(schedule) } : item;
  });
}

function eventDate(value: Record<string, unknown> | null) {
  const dateTime = stringValue(value?.dateTime);
  if (dateTime && !Number.isNaN(new Date(dateTime).getTime())) {
    return new Date(dateTime).toISOString();
  }
  const date = stringValue(value?.date);
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function calendarJoinUrl(event: Record<string, unknown>) {
  const direct = normalizeSourceUrl(stringValue(event.hangoutLink));
  if (direct) return direct;
  const conference = asRecord(event.conferenceData);
  for (const entry of arrayOfRecords(conference?.entryPoints)) {
    const uri = normalizeSourceUrl(stringValue(entry.uri));
    if (uri) return uri;
  }
  return null;
}

function headerValue(headers: Record<string, unknown>[], name: string) {
  const header = headers.find(
    (candidate) => stringValue(candidate.name)?.toLowerCase() === name.toLowerCase(),
  );
  return stringValue(header?.value);
}

function notionPageTitle(page: Record<string, unknown>) {
  const properties = asRecord(page.properties);
  for (const property of Object.values(properties ?? {})) {
    const record = asRecord(property);
    if (record?.type !== "title") continue;
    const title = arrayOfRecords(record.title)
      .map((part) => stringValue(part.plain_text))
      .filter(Boolean)
      .join("");
    if (title) return cleanTitle(title, 120);
  }
  return "Untitled Notion page";
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return asRecord(value) ?? {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function cleanTitle(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanOptional(value: string | null, maxLength: number) {
  return value ? cleanTitle(value, maxLength) || null : null;
}

function atLocalHour(date: Date, daysFromNow: number, hour: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + daysFromNow);
  result.setHours(hour, 0, 0, 0);
  if (result.getTime() <= date.getTime()) {
    result.setDate(result.getDate() + 1);
  }
  return result.toISOString();
}

function timestampFromMilliseconds(value: unknown) {
  const milliseconds =
    typeof value === "string" || typeof value === "number"
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : new Date().toISOString();
}

function slackTimestamp(value: string) {
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
}

function relativeDateLabel(value: string) {
  const hours = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 3_600_000),
  );
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function publicSyncError(error: unknown) {
  if (!(error instanceof Error)) return "Sync failed.";
  if (
    /reconnect|credentials|configured|permission|scope|access/i.test(
      error.message,
    )
  ) {
    return error.message.slice(0, 180);
  }
  return "Provider sync failed. Check the local server log.";
}

function isWorkTask(value: unknown): value is WorkTask {
  const task = asRecord(value);
  return Boolean(
    task &&
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      typeof task.dueAt === "string" &&
      Array.isArray(task.sourceIds) &&
      Array.isArray(task.signals),
  );
}

function isScheduleItem(value: unknown): value is ScheduleItem {
  const item = asRecord(value);
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.startAt === "string" &&
      typeof item.endAt === "string",
  );
}

function isFollowUp(value: unknown): value is FollowUp {
  const item = asRecord(value);
  return Boolean(
    item &&
      typeof item.id === "string" &&
      typeof item.person === "string" &&
      typeof item.dueAt === "string",
  );
}
