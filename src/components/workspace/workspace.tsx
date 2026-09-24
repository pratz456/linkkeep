"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "@/components/workspace/icon";
import { parseConnectionsCsv } from "@/lib/csv";
import {
  formatHorizonRange,
  getCompletionStats,
  getHorizonEnd,
  getHorizonStart,
  groupByImportance,
  prioritizeTasks,
  projectTask,
  scheduleForHorizon,
} from "@/lib/workspace/prioritize";
import type {
  ConnectorId,
  FollowUp,
  Horizon,
  PublicConnectorState,
  ScheduleItem,
  WorkArea,
  WorkTask,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";
import styles from "./workspace.module.css";

const STORAGE_KEY = "morrow-workspace-v1";
const FOCUS_STORAGE_KEY = "morrow-active-focus-v1";
const DISPLAY_TIME_ZONE = "UTC";

const horizonCopy: Record<
  Horizon,
  { label: string; title: string; note: string }
> = {
  today: {
    label: "Today",
    title: "Make today count.",
    note: "A calm stack of what needs your attention now.",
  },
  week: {
    label: "This week",
    title: "Shape the week.",
    note: "Protect the important work before the calendar fills up.",
  },
  month: {
    label: "This month",
    title: "Keep the month on course.",
    note: "See the bigger commitments without losing the next action.",
  },
};

const sourceNames: Record<ConnectorId, string> = {
  gmail: "Gmail",
  slack: "Slack",
  calendar: "Calendar",
  drive: "Google Drive",
  notion: "Notion",
  granola: "Granola",
  linkedin: "LinkedIn",
  manual: "Manual",
  webhook: "Webhook",
};

const sourceLetters: Record<ConnectorId, string> = {
  gmail: "M",
  slack: "S",
  calendar: "C",
  drive: "D",
  notion: "N",
  granola: "G",
  linkedin: "in",
  manual: "+",
  webhook: "W",
};

interface SavedWorkspace {
  completedIds: string[];
  customTasks: WorkTask[];
  sampleOverrides?: Array<{
    id: string;
    status: WorkTask["status"];
    dueAt: string;
    deferredUntil: string | null;
    completedAt: string | null;
  }>;
}

interface UndoMutation {
  task: WorkTask;
  message: string;
}

interface ActiveFocus {
  taskId: string;
  startedAt: string;
}

interface WorkspaceProps {
  initialSnapshot: WorkspaceSnapshot;
  initialConnectors: PublicConnectorState[];
  localMode?: boolean;
}

export function Workspace({
  initialSnapshot,
  initialConnectors,
  localMode = false,
}: WorkspaceProps) {
  const [now, setNow] = useState(
    () => new Date(initialSnapshot.generatedAt),
  );
  const [tasks, setTasks] = useState(initialSnapshot.tasks);
  const [workspaceIsSample, setWorkspaceIsSample] = useState(
    initialSnapshot.isSample,
  );
  const [connectors, setConnectors] = useState(initialConnectors);
  const [horizon, setHorizon] = useState<Horizon>("today");
  const [area, setArea] = useState<WorkArea | "All">("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showAllMinor, setShowAllMinor] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(initialSnapshot.generatedAt);
  const [toast, setToast] = useState<string | null>(null);
  const [undoMutation, setUndoMutation] = useState<UndoMutation | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>(
    initialSnapshot.followUps,
  );
  const [activeFocus, setActiveFocus] = useState<ActiveFocus | null>(null);
  const [focusClock, setFocusClock] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<SavedWorkspace>;
          const completedIds = Array.isArray(parsed.completedIds)
            ? parsed.completedIds.filter(
                (id): id is string => typeof id === "string",
              )
            : [];
          const customTasks = Array.isArray(parsed.customTasks)
            ? parsed.customTasks.filter(isStoredTask)
            : [];
          const sampleOverrides = Array.isArray(parsed.sampleOverrides)
            ? parsed.sampleOverrides.filter(isStoredSampleOverride)
            : [];

          setTasks([
            ...initialSnapshot.tasks.map((task) => {
              const override = sampleOverrides.find(
                (candidate) => candidate.id === task.id,
              );
              if (override) return { ...task, ...override };
              return completedIds.includes(task.id)
                ? { ...task, status: "completed" as const }
                : { ...task, status: "open" as const };
            }),
            ...customTasks,
          ]);
        }

        const storedFocus = window.localStorage.getItem(FOCUS_STORAGE_KEY);
        if (storedFocus) {
          const focus = JSON.parse(storedFocus) as Partial<ActiveFocus>;
          if (
            typeof focus.taskId === "string" &&
            typeof focus.startedAt === "string"
          ) {
            setActiveFocus({
              taskId: focus.taskId,
              startedAt: focus.startedAt,
            });
          }
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(FOCUS_STORAGE_KEY);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [initialSnapshot.tasks]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        searchRef.current?.blur();
        setAddTaskOpen(false);
        setSourcesOpen(false);
        setSelectedTaskId(null);
        setMobileNavOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(async () => {
      const url = new URL(window.location.href);
      const connected = url.searchParams.get("connector_connected");
      const connectorError = url.searchParams.get("connector_error");
      if (!connected && !connectorError) return;

      setSourcesOpen(true);
      setToast(
        connected
          ? `${sourceNames[connected as ConnectorId] ?? "Connector"} authorization saved`
          : "Connector authorization was not completed",
      );
      url.searchParams.delete("connector_connected");
      url.searchParams.delete("connector_error");
      url.searchParams.delete("connector");
      window.history.replaceState({}, "", url);

      if (connected) {
        try {
          const syncResponse = await fetch("/api/connectors/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: connected }),
          });
          if (syncResponse.ok) {
            const syncPayload = (await syncResponse.json()) as {
              snapshot?: WorkspaceSnapshot;
              outcomes?: Array<{
                provider: ConnectorId;
                ok: boolean;
                processed: number;
              }>;
            };
            const snapshot = syncPayload.snapshot;
            if (snapshot) {
              setTasks((current) =>
                mergeSyncedTasks(current, snapshot.tasks),
              );
              setFollowUps(snapshot.followUps);
              setWorkspaceIsSample(snapshot.isSample);
            }
            const outcome = syncPayload.outcomes?.[0];
            if (outcome?.ok) {
              setToast(
                `${sourceNames[outcome.provider]} connected · ${outcome.processed} item${
                  outcome.processed === 1 ? "" : "s"
                } synced`,
              );
            }
          }
          const response = await fetch("/api/connectors", {
            cache: "no-store",
          });
          const payload = (await response.json()) as {
            connectors?: PublicConnectorState[];
            checkedAt?: string;
          };
          if (response.ok && Array.isArray(payload.connectors)) {
            setConnectors(payload.connectors);
            setCheckedAt(payload.checkedAt ?? new Date().toISOString());
          }
        } catch {
          setToast("Authorization saved; source status could not refresh");
        }
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function restoreViewFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const savedHorizon = params.get("horizon");
      const savedArea = params.get("area");
      if (
        savedHorizon === "today" ||
        savedHorizon === "week" ||
        savedHorizon === "month"
      ) {
        setHorizon(savedHorizon);
      }
      if (
        savedArea === "Work" ||
        savedArea === "Personal" ||
        savedArea === "Wellbeing"
      ) {
        setArea(savedArea);
      } else {
        setArea("All");
      }
    }

    const frame = window.requestAnimationFrame(restoreViewFromUrl);
    window.addEventListener("popstate", restoreViewFromUrl);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("popstate", restoreViewFromUrl);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
      setUndoMutation(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!activeFocus) return;
    const interval = window.setInterval(() => setFocusClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeFocus]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (
      !connectors.some(
        (connector) =>
          connector.status === "authorized" ||
          connector.status === "connected",
      )
    ) {
      return;
    }
    async function syncInBackground() {
      try {
        const response = await fetch("/api/connectors/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as {
          snapshot?: WorkspaceSnapshot;
        };
        const snapshot = payload.snapshot;
        if (!snapshot) return;
        setTasks((current) =>
          mergeSyncedTasks(current, snapshot.tasks),
        );
        setFollowUps(snapshot.followUps);
        setWorkspaceIsSample(snapshot.isSample);
        setCheckedAt(new Date().toISOString());
      } catch {
        // Keep the last successful local snapshot and retry on the next interval.
      }
    }
    void syncInBackground();
    const interval = window.setInterval(syncInBackground, 5 * 60_000);
    return () => window.clearInterval(interval);
  }, [connectors]);

  const openTasks = useMemo(
    () => prioritizeTasks(tasks, horizon, now),
    [tasks, horizon, now],
  );

  const filteredTasks = useMemo(
    () =>
      openTasks.filter(
        (task) =>
          (area === "All" || task.area === area) &&
          matchesQuery(task, query),
      ),
    [area, openTasks, query],
  );

  const groupedTasks = useMemo(
    () => groupByImportance(filteredTasks),
    [filteredTasks],
  );
  const focusTask = groupedTasks.major[0] ?? groupedTasks.minor[0] ?? null;

  const completedTasks = useMemo(() => {
    const horizonStart = getHorizonStart(horizon, now).getTime();
    const horizonEnd = getHorizonEnd(horizon, now).getTime();
    return tasks
      .filter(
        (task) =>
          task.status === "completed" &&
          new Date(task.completedAt ?? task.dueAt).getTime() >= horizonStart &&
          new Date(task.dueAt).getTime() <= horizonEnd &&
          (area === "All" || task.area === area) &&
          matchesQuery(task, query),
      )
      .sort(
        (a, b) =>
          new Date(b.dueAt).getTime() - new Date(a.dueAt).getTime(),
      );
  }, [area, horizon, now, query, tasks]);

  const schedule = useMemo(
    () => scheduleForHorizon(initialSnapshot.schedule, horizon, now),
    [horizon, initialSnapshot.schedule, now],
  );
  const attentionSignals = useMemo(
    () =>
      filteredTasks
        .flatMap((task) =>
          task.signals
            .filter(
              (signal) =>
                signal.connectorId === "gmail" ||
                signal.connectorId === "slack",
            )
            .map((signal) => ({ signal, task })),
        )
        .slice(0, 4),
    [filteredTasks],
  );
  const nextMeeting =
    schedule.find(
      (item) =>
        item.kind === "meeting" &&
        new Date(item.endAt).getTime() >= now.getTime(),
    ) ?? schedule.find((item) => item.kind === "meeting");
  const activeFocusTask =
    tasks.find((task) => task.id === activeFocus?.taskId) ?? null;
  const activeFocusSeconds = activeFocus
    ? Math.max(
        0,
        Math.floor(
          (focusClock - new Date(activeFocus.startedAt).getTime()) / 1000,
        ),
      )
    : 0;

  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ?? null;
  const stats = getCompletionStats(tasks, horizon, now);
  const focusMinutes = schedule
    .filter((item) => item.kind === "focus")
    .reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          (new Date(item.endAt).getTime() -
            new Date(item.startAt).getTime()) /
            60000,
        ),
      0,
    );
  const meetingCount = schedule.filter((item) => item.kind === "meeting").length;
  const openMinutes = openTasks.reduce(
    (sum, task) => sum + task.estimateMinutes,
    0,
  );
  const weekTasks = prioritizeTasks(tasks, "week", now);
  const weekTaskIds = new Set(weekTasks.map((task) => task.id));
  const laterMonthCount = prioritizeTasks(tasks, "month", now).filter(
    (task) => !weekTaskIds.has(task.id),
  ).length;
  const movedCount = tasks.filter((task) => task.deferredUntil).length;
  const liveCount = connectors.filter(
    (connector) => connector.status === "connected",
  ).length;
  const authorizedCount = connectors.filter(
    (connector) => connector.status === "authorized",
  ).length;
  const dialogOpen = Boolean(selectedTask || sourcesOpen || addTaskOpen);
  const openFollowUps = followUps
    .filter((followUp) => followUp.status === "open")
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "explicit" ? -1 : 1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });

  const areaCounts = useMemo(() => {
    return openTasks.reduce<Record<WorkArea, number>>(
      (counts, task) => {
        counts[task.area] += 1;
        return counts;
      },
      { Work: 0, Personal: 0, Wellbeing: 0 },
    );
  }, [openTasks]);

  function persist(nextTasks: WorkTask[]) {
    const saved: SavedWorkspace = {
      completedIds: nextTasks
        .filter((task) => task.isSample && task.status === "completed")
        .map((task) => task.id),
      customTasks: nextTasks.filter(isManualTask),
      sampleOverrides: nextTasks
        .filter((task) => !isManualTask(task))
        .map((task) => ({
          id: task.id,
          status: task.status,
          dueAt: task.dueAt,
          deferredUntil: task.deferredUntil ?? null,
          completedAt: task.completedAt ?? null,
        })),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }

  function toggleTask(taskId: string) {
    const previous = tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const completing = previous.status !== "completed";
    setTasks((current) => {
      const next = current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: completing ? "completed" : "open",
              completedAt: completing ? new Date().toISOString() : null,
            }
          : task,
      ) as WorkTask[];
      persist(next);
      return next;
    });
    setUndoMutation({
      task: previous,
      message: completing ? "Task completed" : "Task restored",
    });
    setToast(completing ? "Task completed" : "Task restored");
  }

  function deferTask(taskId: string) {
    const previous = tasks.find((task) => task.id === taskId);
    if (!previous) return;
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(17, 0, 0, 0);
    setTasks((current) => {
      const next = current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "open" as const,
              dueAt: tomorrow.toISOString(),
              deferredUntil: tomorrow.toISOString(),
            }
          : task,
      );
      persist(next);
      return next;
    });
    setUndoMutation({ task: previous, message: "Task deferred" });
    setToast("Moved to tomorrow");
  }

  function undoLastMutation() {
    if (!undoMutation) return;
    setTasks((current) => {
      const next = current.map((task) =>
        task.id === undoMutation.task.id ? undoMutation.task : task,
      );
      persist(next);
      return next;
    });
    setToast(`${undoMutation.message} undone`);
    setUndoMutation(null);
  }

  function startFocus(taskId: string) {
    const task = tasks.find((candidate) => candidate.id === taskId);
    const startedAt = new Date();
    const minutesUntilMeeting = nextMeeting
      ? (new Date(nextMeeting.startAt).getTime() - startedAt.getTime()) / 60000
      : Number.POSITIVE_INFINITY;
    if (
      task &&
      minutesUntilMeeting > 0 &&
      minutesUntilMeeting < task.estimateMinutes &&
      !window.confirm(
        `Only ${Math.max(
          1,
          Math.floor(minutesUntilMeeting),
        )} minutes remain before the next meeting. Start a shorter focus block?`,
      )
    ) {
      return;
    }
    const focus = { taskId, startedAt: startedAt.toISOString() };
    setActiveFocus(focus);
    window.localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(focus));
    setFocusClock(startedAt.getTime());
    setToast("Focus session started");
  }

  function endFocus() {
    setActiveFocus(null);
    window.localStorage.removeItem(FOCUS_STORAGE_KEY);
    setToast("Focus session ended");
  }

  function completeFollowUp(followUpId: string) {
    setFollowUps((current) =>
      current.map((followUp) =>
        followUp.id === followUpId
          ? { ...followUp, status: "completed" as const }
          : followUp,
      ),
    );
    setToast("Follow-up marked complete");
  }

  function clearLocalWorkspace() {
    if (
      !window.confirm(
        "Clear manual tasks, completion state, and the active focus session from this browser?",
      )
    ) {
      return;
    }
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(FOCUS_STORAGE_KEY);
    setTasks(initialSnapshot.tasks);
    setFollowUps(initialSnapshot.followUps);
    setActiveFocus(null);
    setUndoMutation(null);
    setToast("Local workspace cleared");
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const dueDate = String(formData.get("dueDate") ?? "");
    if (!title || !dueDate) return;

    const dueAt = new Date(`${dueDate}T17:00:00Z`);
    const task: WorkTask = {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `manual-${Date.now()}`,
      title,
      project: String(formData.get("project") ?? "").trim() || "Unsorted",
      area: String(formData.get("area")) as WorkArea,
      importance: formData.get("importance") === "major" ? "major" : "minor",
      status: "open",
      dueAt: dueAt.toISOString(),
      estimateMinutes: Number(formData.get("estimate")) || 30,
      sourceIds: ["manual"],
      signals: [],
      rationale: "Added manually and kept in this browser.",
      reasonCodes: ["manual_commitment"],
      priority: {
        deadlineKind: "soft",
        deadlineConfidence: 1,
        impactLevel:
          formData.get("importance") === "major" ? 3 : 1,
        impactConfidence: 1,
        commitmentKind: "manual",
        commitmentConfidence: 1,
        accepted: true,
        lastUserTouchAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
      isSample: false,
    };

    setTasks((current) => {
      const next = [...current, task];
      persist(next);
      return next;
    });
    event.currentTarget.reset();
    setAddTaskOpen(false);
    setSelectedTaskId(task.id);
    setToast("Task added to your local workspace");
  }

  async function refreshConnectors() {
    setRefreshing(true);
    try {
      const hasAuthorizedSource = connectors.some(
        (connector) =>
          connector.status === "authorized" ||
          connector.status === "connected",
      );
      if (hasAuthorizedSource) {
        const syncResponse = await fetch("/api/connectors/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (syncResponse.ok) {
          const syncPayload = (await syncResponse.json()) as {
            snapshot?: WorkspaceSnapshot;
            outcomes?: Array<{
              provider: ConnectorId;
              ok: boolean;
              processed: number;
              error?: string;
            }>;
          };
          const snapshot = syncPayload.snapshot;
          if (snapshot) {
            setTasks((current) =>
              mergeSyncedTasks(current, snapshot.tasks),
            );
            setFollowUps(snapshot.followUps);
            setWorkspaceIsSample(snapshot.isSample);
          }
          const failures =
            syncPayload.outcomes?.filter((outcome) => !outcome.ok) ?? [];
          if (failures.length) {
            setToast(
              failures.length === 1
                ? `${sourceNames[failures[0].provider]}: ${failures[0].error ?? "sync failed"}`
                : `${failures.length} sources could not sync`,
            );
          }
        }
      }
      const response = await fetch("/api/connectors", { cache: "no-store" });
      if (!response.ok) throw new Error("status request failed");
      const payload = (await response.json()) as {
        connectors?: PublicConnectorState[];
        checkedAt?: string;
      };
      if (!Array.isArray(payload.connectors)) throw new Error("invalid response");
      setConnectors(payload.connectors);
      setCheckedAt(payload.checkedAt ?? new Date().toISOString());
      setToast((current) => current ?? "Sources refreshed");
    } catch {
      setToast("Could not refresh source status");
    } finally {
      setRefreshing(false);
    }
  }

  async function disconnectConnector(connectorId: ConnectorId) {
    if (
      !window.confirm(
        `Delete the local ${sourceNames[connectorId]} authorization? This development seam does not revoke the grant at the provider; revoke it in the provider settings too.`,
      )
    ) {
      return;
    }
    try {
      const response = await fetch(`/api/connectors/${connectorId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("disconnect failed");
      setToast(`${sourceNames[connectorId]} disconnected`);
      await refreshConnectors();
    } catch {
      setToast(`${sourceNames[connectorId]} could not be disconnected`);
    }
  }

  async function importLocalSource(
    connectorId: Extract<ConnectorId, "granola" | "linkedin">,
    file: File,
  ) {
    if (file.size > 5 * 1024 * 1024) {
      setToast("Choose an export smaller than 5 MB");
      return;
    }
    try {
      const text = await file.text();
      const imported =
        connectorId === "linkedin"
          ? tasksFromLinkedInCsv(text, now)
          : tasksFromGranolaExport(text, file.name, now);
      if (!imported.length) {
        setToast(
          connectorId === "linkedin"
            ? "No LinkedIn connection rows were found"
            : "No unchecked action items were found in that Granola export",
        );
        return;
      }
      setTasks((current) => {
        const importedIds = new Set(imported.map((task) => task.id));
        const next = [
          ...current.filter((task) => !importedIds.has(task.id)),
          ...imported,
        ];
        persist(next);
        return next;
      });
      setToast(
        `Imported ${imported.length} ${connectorId === "linkedin" ? "relationship follow-up" : "meeting action"}${
          imported.length === 1 ? "" : "s"
        } locally`,
      );
    } catch {
      setToast("That export could not be read");
    }
  }

  function selectHorizon(nextHorizon: Horizon) {
    setHorizon(nextHorizon);
    setShowAllMinor(false);
    setMobileNavOpen(false);
    updateViewUrl(nextHorizon, area);
  }

  function selectArea(nextArea: WorkArea | "All") {
    setArea(nextArea);
    setMobileNavOpen(false);
    updateViewUrl(horizon, nextArea);
  }

  function openMeeting(meeting: ScheduleItem) {
    if (meeting.joinUrl) {
      try {
        const url = new URL(meeting.joinUrl);
        if (url.protocol === "https:") {
          window.open(url.toString(), "_blank", "noopener,noreferrer");
          return;
        }
      } catch {
        // Fall through to a safe local notice.
      }
    }
    setToast(
      workspaceIsSample
        ? "Sample meeting has no live calendar link"
        : "This calendar event has no secure meeting link",
    );
  }

  function updateViewUrl(
    nextHorizon: Horizon,
    nextArea: WorkArea | "All",
  ) {
    const url = new URL(window.location.href);
    if (nextHorizon === "today") url.searchParams.delete("horizon");
    else url.searchParams.set("horizon", nextHorizon);
    if (nextArea === "All") url.searchParams.delete("area");
    else url.searchParams.set("area", nextArea);
    window.history.pushState({}, "", url);
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#workspace-main">
        Skip to priorities
      </a>

      <aside
        className={`${styles.sidebar} ${
          mobileNavOpen ? styles.sidebarOpen : ""
        }`}
        aria-label="Workspace navigation"
        aria-hidden={dialogOpen || undefined}
        inert={dialogOpen || undefined}
      >
        <div className={styles.brandRow}>
          <div className={styles.brandMark} aria-hidden="true">
            <span />
            <span />
          </div>
          <span className={styles.brandName}>morrow</span>
          <button
            type="button"
            className={styles.mobileClose}
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.previewBadge}>
          <span className={styles.previewDot} />
          Sample workspace
        </div>

        <nav className={styles.navSection} aria-label="Time horizons">
          <p className={styles.navLabel}>Focus</p>
          {(["today", "week", "month"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`${styles.navItem} ${
                horizon === item ? styles.navItemActive : ""
              }`}
              onClick={() => selectHorizon(item)}
              aria-current={horizon === item ? "page" : undefined}
            >
              <Icon
                name={
                  item === "today"
                    ? "sun"
                    : item === "week"
                      ? "calendar"
                      : "grid"
                }
                size={17}
              />
              <span>{horizonCopy[item].label}</span>
              {item === "today" ? (
                <span className={styles.navCount}>
                  {prioritizeTasks(tasks, item, now).length}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <nav className={styles.navSection} aria-label="Work areas">
          <p className={styles.navLabel}>Areas</p>
          {(["All", "Work", "Personal", "Wellbeing"] as const).map(
            (item) => (
              <button
                key={item}
                type="button"
                className={`${styles.areaItem} ${
                  area === item ? styles.areaItemActive : ""
                }`}
                onClick={() => selectArea(item)}
                aria-pressed={area === item}
              >
                <span
                  className={styles.areaDot}
                  data-area={item.toLowerCase()}
                />
                <span>{item === "All" ? "Everything" : item}</span>
                <span className={styles.areaCount}>
                  {item === "All" ? openTasks.length : areaCounts[item]}
                </span>
              </button>
            ),
          )}
        </nav>

        <div className={styles.sidebarSpacer} />

        <button
          type="button"
          className={styles.sourceSummary}
          onClick={() => {
            setSourcesOpen(true);
            setMobileNavOpen(false);
          }}
        >
          <span className={styles.sourceSummaryIcon}>
            <Icon name="layers" size={17} />
          </span>
          <span>
            <strong>Sources</strong>
            <small>
              {liveCount} live · {authorizedCount} authorized
            </small>
          </span>
          <Icon name="chevron-right" size={16} />
        </button>

        <div className={styles.profileRow}>
          <div className={styles.avatar}>M</div>
          <div>
            <strong>My workspace</strong>
            <small>Private preview</small>
          </div>
          <Icon name="more" size={17} />
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          type="button"
          className={styles.mobileOverlay}
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <div
        className={styles.appColumn}
        aria-hidden={dialogOpen || undefined}
        inert={dialogOpen || undefined}
      >
        <header className={styles.topbar}>
          <button
            type="button"
            className={styles.mobileMenu}
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
          <div className={styles.mobileBrand}>morrow</div>

          <label className={styles.search}>
            <Icon name="search" size={17} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchOpen(true)}
              onBlur={() =>
                window.setTimeout(() => setSearchOpen(false), 120)
              }
              placeholder="Search work, people, and messages"
              aria-label="Search work, people, and messages"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
              >
                <Icon name="close" size={15} />
              </button>
            ) : (
              <kbd>⌘K</kbd>
            )}
          </label>
          {searchOpen && query.trim() ? (
            <div
              className={styles.globalSearchResults}
              role="listbox"
              aria-label="Search results"
              onMouseDown={(event) => event.preventDefault()}
            >
              <p>Work</p>
              {tasks.filter((task) => matchesQuery(task, query)).slice(0, 5)
                .length ? (
                tasks
                  .filter((task) => matchesQuery(task, query))
                  .slice(0, 5)
                  .map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      role="option"
                      aria-selected="false"
                      onClick={() => {
                        setSelectedTaskId(task.id);
                        setSearchOpen(false);
                      }}
                    >
                      <SourceStack sourceIds={task.sourceIds} compact />
                      <span>
                        <strong>{task.title}</strong>
                        <small>
                          {task.project} · {task.rationale}
                        </small>
                      </span>
                      <Icon name="arrow-right" size={14} />
                    </button>
                  ))
              ) : (
                <span className={styles.noSearchResults}>
                  No work matches “{query}”
                </span>
              )}
              <p>People</p>
              {followUps
                .filter((followUp) =>
                  `${followUp.person} ${followUp.context}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .slice(0, 3)
                .map((followUp) => (
                  <button
                    type="button"
                    key={followUp.id}
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      setSearchOpen(false);
                      setToast(
                        "People detail is not available in the sample workspace",
                      );
                    }}
                  >
                    <span className={styles.searchPerson}>
                      {followUp.person.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{followUp.person}</strong>
                      <small>{followUp.context}</small>
                    </span>
                  </button>
                ))}
            </div>
          ) : null}

          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.sourceButton}
              onClick={() => setSourcesOpen(true)}
              aria-label="Open source health"
            >
              <span className={styles.statusIndicator} />
              <span>
                {liveCount
                  ? `Updated ${formatRelativeDate(checkedAt, now)}`
                  : authorizedCount
                    ? "Sync pending"
                    : "Sources need setup"}
              </span>
              <span className={styles.sourceCount}>
                {liveCount || authorizedCount}
              </span>
            </button>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setAddTaskOpen(true)}
              aria-label="Add task"
            >
              <Icon name="plus" size={17} />
              <span>Add task</span>
            </button>
          </div>
        </header>

        <main id="workspace-main" className={styles.main}>
          <section
            className={styles.sampleNotice}
            data-live={!workspaceIsSample || undefined}
            aria-label={workspaceIsSample ? "Preview status" : "Sync status"}
          >
            <div className={styles.sampleIcon}>
              <Icon name={workspaceIsSample ? "sparkles" : "link"} size={16} />
            </div>
            <p>
              <strong>
                {workspaceIsSample
                  ? "You’re viewing sample context."
                  : "Your local workspace is live."}
              </strong>{" "}
              <span>
                {workspaceIsSample
                  ? "No email, Slack, calendar, or meeting data has been accessed."
                  : "Connected sources sync only through this Mac and its encrypted local database."}
              </span>
            </p>
            <button type="button" onClick={() => setSourcesOpen(true)}>
              {workspaceIsSample ? "Review sources" : "Manage sources"}{" "}
              <Icon name="arrow-right" size={14} />
            </button>
          </section>

          <section className={styles.pageHeading}>
            <div>
              <p className={styles.eyebrow}>{horizonCopy[horizon].label}</p>
              <h1>
                {horizon === "today"
                  ? `${getGreeting(now)}.`
                  : horizonCopy[horizon].title}
              </h1>
              <p className={styles.headingNote}>
                {horizon === "today"
                  ? `${Math.min(groupedTasks.major.length, 3)} outcome${
                      groupedTasks.major.length === 1 ? "" : "s"
                    } need focus around ${meetingCount} meeting${
                      meetingCount === 1 ? "" : "s"
                    }. ${attentionSignals.length} signal${
                      attentionSignals.length === 1 ? "" : "s"
                    } need a look.`
                  : horizonCopy[horizon].note}
              </p>
            </div>
            <div className={styles.headingDate}>
              <span>
                {formatHorizonRange(horizon, now)} · {initialSnapshot.timeZone}
              </span>
              <div className={styles.horizonTabs} aria-label="Change time range">
                {(["today", "week", "month"] as const).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={horizon === item}
                    onClick={() => selectHorizon(item)}
                  >
                    {item === "today"
                      ? "Day"
                      : item === "week"
                        ? "Week"
                        : "Month"}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className={styles.dayPulse} aria-label="At a glance">
            {focusTask ? (
              <button
                type="button"
                className={`${styles.pulseCard} ${styles.pulseFocus}`}
                onClick={() => setSelectedTaskId(focusTask.id)}
              >
                <span className={styles.pulseIcon}>
                  <Icon name="target" size={17} />
                </span>
                <span className={styles.pulseCopy}>
                  <small>Focus now</small>
                  <strong>{focusTask.title}</strong>
                  <em>
                    {formatDuration(focusTask.estimateMinutes)} ·{" "}
                    {formatDue(focusTask.dueAt, now)}
                  </em>
                </span>
                <Icon name="arrow-right" size={16} />
              </button>
            ) : (
              <article className={`${styles.pulseCard} ${styles.pulseFocus}`}>
                <span className={styles.pulseIcon}>
                  <Icon name="check" size={17} />
                </span>
                <span className={styles.pulseCopy}>
                  <small>Focus now</small>
                  <strong>Your priority stack is clear</strong>
                  <em>Add a commitment when something needs attention.</em>
                </span>
              </article>
            )}

            {nextMeeting ? (
              <button
                type="button"
                className={`${styles.pulseCard} ${styles.pulseMeeting}`}
                onClick={() => openMeeting(nextMeeting)}
              >
                <span className={styles.pulseIcon}>
                  <Icon name="calendar" size={17} />
                </span>
                <span className={styles.pulseCopy}>
                  <small>{formatCountdown(nextMeeting.startAt, now)}</small>
                  <strong>{nextMeeting.title}</strong>
                  <em>
                    {formatClockTime(nextMeeting.startAt)} ·{" "}
                    {nextMeeting.attendees ?? 1} people
                  </em>
                </span>
                <Icon name="arrow-right" size={16} />
              </button>
            ) : (
              <article className={`${styles.pulseCard} ${styles.pulseMeeting}`}>
                <span className={styles.pulseIcon}>
                  <Icon name="calendar" size={17} />
                </span>
                <span className={styles.pulseCopy}>
                  <small>Calendar</small>
                  <strong>No meeting pressure ahead</strong>
                  <em>Your visible schedule is open.</em>
                </span>
              </article>
            )}

            <article className={`${styles.pulseCard} ${styles.pulseProgress}`}>
              <span className={styles.pulseIcon}>
                <Icon name="check" size={17} />
              </span>
              <span className={styles.pulseCopy}>
                <small>Momentum</small>
                <strong>{stats.percent}% complete</strong>
                <em>
                  {stats.completed} of {stats.total} ·{" "}
                  {formatDuration(openMinutes)} left
                </em>
                <span className={styles.pulseProgressBar} aria-hidden="true">
                  <span style={{ width: `${stats.percent}%` }} />
                </span>
              </span>
            </article>
          </section>

          {area !== "All" || query ? (
            <div className={styles.activeFilters} aria-label="Active filters">
              <span>
                <Icon name="search" size={14} />
                Showing
              </span>
              {area !== "All" ? (
                <button type="button" onClick={() => selectArea("All")}>
                  Area: {area}
                  <Icon name="close" size={13} />
                </button>
              ) : null}
              {query ? (
                <button type="button" onClick={() => setQuery("")}>
                  Search: “{query}”
                  <Icon name="close" size={13} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  selectArea("All");
                }}
              >
                Clear all
              </button>
            </div>
          ) : null}

          {nextMeeting && horizon === "today" ? (
            <div className={styles.mobileNextMeeting}>
              <NextMeetingCard
                meeting={nextMeeting}
                now={now}
                onOpen={() => openMeeting(nextMeeting)}
              />
            </div>
          ) : null}

          <div className={styles.contentGrid}>
            <section className={styles.priorityPanel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionKicker}>Major work</p>
                  <h2>What deserves your attention</h2>
                </div>
                <span className={styles.sectionCount}>
                  {filteredTasks.length} open
                </span>
              </div>

              {filteredTasks.length ? (
                <>
                  <div className={styles.majorStack}>
                    {groupedTasks.major.slice(0, 3).map((task, index) => (
                      <MajorTaskCard
                        key={task.id}
                        task={task}
                        now={now}
                        featured={index === 0}
                        onOpen={() => setSelectedTaskId(task.id)}
                        onToggle={() => toggleTask(task.id)}
                      />
                    ))}
                  </div>

                  {groupedTasks.major.length > 3 ? (
                    <div className={styles.planningWarning} role="status">
                      <Icon name="target" size={16} />
                      <span>
                        {groupedTasks.major.length} items are marked major.
                        Choose the top three before adding more to Today.
                      </span>
                      <button type="button">Plan today</button>
                    </div>
                  ) : null}

                  {attentionSignals.length ? (
                    <div className={styles.attentionSection}>
                      <div className={styles.minorHeading}>
                        <div>
                          <span className={styles.attentionMarker} />
                          <h3>Needs attention</h3>
                        </div>
                        <span>Actionable signals only</span>
                      </div>
                      <div className={styles.attentionList}>
                        {attentionSignals.map(({ signal, task }) => (
                          <article key={signal.id}>
                            <SourceMark sourceId={signal.connectorId} />
                            <button
                              type="button"
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              <span>
                                <strong>{signal.label}</strong>
                                <small>{signal.detail}</small>
                              </span>
                              <em
                                data-action={
                                  signal.connectorId === "gmail"
                                    ? "reply"
                                    : "decision"
                                }
                              >
                                {signal.connectorId === "gmail"
                                  ? "Reply likely"
                                  : "Decision needed"}
                              </em>
                            </button>
                            <time dateTime={signal.occurredAt}>
                              {formatRelativeDate(signal.occurredAt, now)}
                            </time>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {groupedTasks.minor.length ? (
                    <div className={styles.minorSection}>
                      <div className={styles.minorHeading}>
                        <div>
                          <span className={styles.minorMarker} />
                          <h3>Quick actions</h3>
                        </div>
                        <span>
                          {formatDuration(
                            groupedTasks.minor.reduce(
                              (sum, task) => sum + task.estimateMinutes,
                              0,
                            ),
                          )}{" "}
                          total
                        </span>
                      </div>
                      <div className={styles.minorList}>
                        {groupedTasks.minor
                          .slice(0, showAllMinor ? undefined : 5)
                          .map((task) => (
                          <MinorTaskRow
                            key={task.id}
                            task={task}
                            now={now}
                            onOpen={() => setSelectedTaskId(task.id)}
                            onToggle={() => toggleTask(task.id)}
                          />
                          ))}
                      </div>
                      {groupedTasks.minor.length > 5 ? (
                        <button
                          type="button"
                          className={styles.showMoreButton}
                          onClick={() =>
                            setShowAllMinor((current) => !current)
                          }
                        >
                          {showAllMinor
                            ? "Show fewer"
                            : `Show ${groupedTasks.minor.length - 5} more`}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  hasQuery={Boolean(query || area !== "All")}
                  onClear={() => {
                    setQuery("");
                    setArea("All");
                  }}
                  onAdd={() => setAddTaskOpen(true)}
                />
              )}

              {completedTasks.length ? (
                <div className={styles.completedSection}>
                  <button
                    type="button"
                    onClick={() => setShowCompleted((current) => !current)}
                    aria-expanded={showCompleted}
                  >
                    <span>
                      <Icon name="check" size={15} />
                      {completedTasks.length} completed
                    </span>
                    <Icon
                      name="chevron-down"
                      size={16}
                      className={showCompleted ? styles.rotateIcon : ""}
                    />
                  </button>
                  {showCompleted ? (
                    <div className={styles.completedList}>
                      {completedTasks.map((task) => (
                        <button
                          type="button"
                          key={task.id}
                          onClick={() => toggleTask(task.id)}
                        >
                          <span className={styles.completeCheck}>
                            <Icon name="check" size={13} />
                          </span>
                          <span>{task.title}</span>
                          <small>Restore</small>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <aside className={styles.rightRail}>
              <section className={styles.schedulePanel}>
                <div className={styles.railHeading}>
                  <div>
                    <p className={styles.sectionKicker}>Your rhythm</p>
                    <h2>{horizon === "today" ? "Today’s shape" : "Coming up"}</h2>
                  </div>
                  <span className={styles.liveLabel}>
                    {workspaceIsSample ? "Sample" : "Live"}
                  </span>
                </div>
                {nextMeeting && horizon === "today" ? (
                  <NextMeetingCard
                    meeting={nextMeeting}
                    now={now}
                    onOpen={() => openMeeting(nextMeeting)}
                  />
                ) : null}
                {schedule.length ? (
                  <div className={styles.timeline}>
                    {schedule
                      .filter(
                        (item) =>
                          horizon !== "today" || item.id !== nextMeeting?.id,
                      )
                      .slice(0, horizon === "today" ? 5 : 7)
                      .map((item) => (
                        <ScheduleRow
                          key={item.id}
                          item={item}
                          now={now}
                          showDay={horizon !== "today"}
                        />
                      ))}
                  </div>
                ) : (
                  <p className={styles.emptySchedule}>
                    No sample calendar items in this range.
                  </p>
                )}
              </section>

              <section className={styles.focusPanel}>
                <div className={styles.railHeading}>
                  <div>
                    <p className={styles.sectionKicker}>Focus</p>
                    <h2>
                      {activeFocusTask ? "Focus in progress" : "Protect a block"}
                    </h2>
                  </div>
                  <Icon name="target" size={18} />
                </div>
                {activeFocusTask ? (
                  <div className={styles.activeFocus}>
                    <p>{activeFocusTask.title}</p>
                    <strong
                      aria-label={`${formatElapsedTime(activeFocusSeconds)} elapsed`}
                    >
                      {formatElapsedTime(activeFocusSeconds)}
                    </strong>
                    <span>
                      Next interruption:{" "}
                      {nextMeeting
                        ? formatCountdown(
                            nextMeeting.startAt,
                            now,
                            nextMeeting.endAt,
                          ).toLowerCase()
                        : "none scheduled"}
                    </span>
                    <button type="button" onClick={endFocus}>
                      End focus
                    </button>
                  </div>
                ) : groupedTasks.major[0] ? (
                  <div className={styles.focusSuggestion}>
                    <p>{groupedTasks.major[0].title}</p>
                    <span>
                      Suggested {Math.min(groupedTasks.major[0].estimateMinutes, 60)}
                      m block · stops before the next calendar interruption.
                    </span>
                    <button
                      type="button"
                      onClick={() => startFocus(groupedTasks.major[0].id)}
                    >
                      Start focus
                    </button>
                  </div>
                ) : (
                  <p className={styles.emptySchedule}>
                    Choose a major outcome to create a focus block.
                  </p>
                )}
              </section>

              <section className={styles.followUpPanel}>
                <div className={styles.railHeading}>
                  <div>
                    <p className={styles.sectionKicker}>People</p>
                    <h2>Follow-ups</h2>
                  </div>
                  <span className={styles.sectionCount}>
                    {openFollowUps.length} due
                  </span>
                </div>
                <div className={styles.followUpList}>
                  {openFollowUps.length ? (
                    openFollowUps.slice(0, 3).map((followUp) => (
                      <article key={followUp.id}>
                        <div className={styles.followUpAvatar}>
                          {followUp.person
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div>
                          <strong>{followUp.person}</strong>
                          <span>{followUp.reason}</span>
                          <small>
                            {followUp.kind === "suggested"
                              ? "Suggestion"
                              : formatDue(followUp.dueAt, now)}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => completeFollowUp(followUp.id)}
                          aria-label={`Mark follow-up with ${followUp.person} complete`}
                        >
                          <Icon name="check" size={14} />
                        </button>
                      </article>
                    ))
                  ) : (
                    <p className={styles.emptyRailState}>
                      No follow-ups were found in connected sources.
                    </p>
                  )}
                </div>
              </section>

              <section
                className={styles.contextPanel}
                aria-busy={refreshing}
              >
                <div className={styles.railHeading}>
                  <div>
                    <p className={styles.sectionKicker}>Context pulse</p>
                    <h2>Source health</h2>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={() => void refreshConnectors()}
                    aria-label="Refresh source status"
                    disabled={refreshing}
                  >
                    <Icon
                      name="refresh"
                      size={16}
                      className={refreshing ? styles.spinning : ""}
                    />
                  </button>
                </div>
                <div className={styles.connectorMiniList}>
                  {connectors.slice(0, 5).map((connector) => (
                    <button
                      type="button"
                      key={connector.id}
                      onClick={() => setSourcesOpen(true)}
                    >
                      <SourceMark sourceId={connector.id} />
                      <span>
                        <strong>{connector.label}</strong>
                        <small>{connector.statusLabel}</small>
                      </span>
                      <span
                        className={styles.connectorStatusDot}
                        data-status={connector.status}
                      />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.reviewSources}
                  onClick={() => setSourcesOpen(true)}
                >
                  Review connector plan
                  <Icon name="arrow-right" size={15} />
                </button>
              </section>
            </aside>
          </div>

          <section className={styles.progressStrip} aria-label="Plan progress">
            <div>
              <strong>
                {stats.completed} of {stats.total} commitments complete
              </strong>
              <span>
                {formatDuration(openMinutes)} remaining ·{" "}
                {formatDuration(focusMinutes)} intentionally scheduled ·{" "}
                {movedCount} moved
              </span>
            </div>
            <div
              className={styles.progressBar}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={stats.total}
              aria-valuenow={stats.completed}
              aria-label={`${stats.completed} of ${stats.total} commitments complete`}
            >
              <span
                style={{
                  width: `${stats.total ? Math.max(3, stats.percent) : 0}%`,
                }}
              />
            </div>
            <button type="button" onClick={() => selectHorizon("week")}>
              This week: {weekTasks.length} open · {laterMonthCount} later this
              month
              <Icon name="arrow-right" size={15} />
            </button>
          </section>
        </main>
      </div>

      <nav
        className={styles.mobileBottomNav}
        aria-label="Mobile navigation"
        aria-hidden={dialogOpen || undefined}
        inert={dialogOpen || undefined}
      >
        <button
          type="button"
          data-active={horizon === "today"}
          onClick={() => selectHorizon("today")}
        >
          <Icon name="sun" size={19} />
          <span>Today</span>
        </button>
        <button type="button" onClick={() => searchRef.current?.focus()}>
          <Icon name="inbox" size={19} />
          <span>Inbox</span>
        </button>
        <button type="button" onClick={() => searchRef.current?.focus()}>
          <Icon name="search" size={19} />
          <span>Search</span>
        </button>
        <button type="button" onClick={() => setMobileNavOpen(true)}>
          <Icon name="menu" size={19} />
          <span>More</span>
        </button>
      </nav>

      {selectedTask ? (
        <TaskDrawer
          task={selectedTask}
          now={now}
          onClose={() => setSelectedTaskId(null)}
          onToggle={() => toggleTask(selectedTask.id)}
          onDefer={() => deferTask(selectedTask.id)}
        />
      ) : null}

      {sourcesOpen ? (
        <SourcesDrawer
          connectors={connectors}
          checkedAt={checkedAt}
          refreshing={refreshing}
          onRefresh={() => void refreshConnectors()}
          onDisconnect={(connectorId) =>
            void disconnectConnector(connectorId)
          }
          onImport={(connectorId, file) =>
            void importLocalSource(connectorId, file)
          }
          onClearLocal={clearLocalWorkspace}
          localMode={localMode}
          onClose={() => setSourcesOpen(false)}
        />
      ) : null}

      {addTaskOpen ? (
        <AddTaskDialog
          now={now}
          onClose={() => setAddTaskOpen(false)}
          onSubmit={addTask}
        />
      ) : null}

      <div className={styles.toastRegion} aria-live="polite" aria-atomic="true">
        {toast ? (
          <div className={styles.toast}>
            <span>
              <Icon name="check" size={14} />
            </span>
            <p>{toast}</p>
            {undoMutation ? (
              <button type="button" onClick={undoLastMutation}>
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NextMeetingCard({
  meeting,
  now,
  onOpen,
}: {
  meeting: ScheduleItem;
  now: Date;
  onOpen: () => void;
}) {
  const start = new Date(meeting.startAt);
  const minutesUntil = (start.getTime() - now.getTime()) / 60000;
  const canJoin =
    Boolean(meeting.joinUrl) && minutesUntil <= 10 && minutesUntil >= -15;
  const countdown = formatCountdown(meeting.startAt, now, meeting.endAt);

  return (
    <article className={styles.nextMeetingCard}>
      <div className={styles.nextMeetingTime}>
        <span data-state={minutesUntil <= 0 ? "active" : "upcoming"}>
          {countdown}
        </span>
        <strong>
          {formatClockTime(meeting.startAt)}
        </strong>
        <small>
          until {formatClockTime(meeting.endAt)}
        </small>
      </div>
      <div className={styles.nextMeetingBody}>
        <h3>{meeting.title}</h3>
        <p>
          {meeting.attendees ?? 1} people
          {meeting.location ? ` · ${meeting.location}` : " · No location"}
        </p>
        {meeting.preparationNote ? (
          <span>
            <Icon name="sparkles" size={14} />
            {meeting.preparationNote}
          </span>
        ) : null}
        {meeting.conflictState && meeting.conflictState !== "none" ? (
          <em>
            {meeting.conflictState === "overlap"
              ? "Overlaps another event"
              : "Back-to-back meeting"}
          </em>
        ) : null}
      </div>
      <button type="button" onClick={onOpen}>
        {canJoin ? "Join meeting" : "View details"}
        <Icon name="arrow-right" size={14} />
      </button>
    </article>
  );
}

function MajorTaskCard({
  task,
  now,
  featured,
  onOpen,
  onToggle,
}: {
  task: WorkTask;
  now: Date;
  featured: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <article
      className={`${styles.majorCard} ${
        featured ? styles.majorCardFeatured : ""
      }`}
      data-urgency={getDueTone(task.dueAt, now)}
    >
      <button
        type="button"
        className={styles.cardHitArea}
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
      />
      <div className={styles.majorTopline}>
        <span className={styles.majorPill}>
          <span />
          Major
        </span>
        {task.isSample ? <span className={styles.samplePill}>Sample</span> : null}
      </div>
      <p className={styles.taskProject}>{task.project}</p>
      <h3>{task.title}</h3>
      <p className={styles.taskRationale}>{task.rationale}</p>
      <div className={styles.signalRow}>
        <SourceStack sourceIds={task.sourceIds} />
        <span>
          {task.signals.length
            ? `${task.signals.length} context signal${
                task.signals.length === 1 ? "" : "s"
              } · latest ${formatRelativeDate(
                task.signals.reduce((latest, signal) =>
                  new Date(signal.occurredAt).getTime() >
                  new Date(latest).getTime()
                    ? signal.occurredAt
                    : latest,
                  task.signals[0].occurredAt,
                ),
                now,
              )}`
            : "User-authored · browser local"}
        </span>
      </div>
      <footer className={styles.majorFooter}>
        <div>
          <span className={styles.effortMeta}>
            <Icon name="clock" size={14} />
            <small>Effort</small>
            <strong>{formatDuration(task.estimateMinutes)}</strong>
          </span>
          <span
            className={styles.dueMeta}
            data-urgency={getDueTone(task.dueAt, now)}
          >
            <Icon name="calendar" size={14} />
            <small>Due</small>
            <strong>{formatDue(task.dueAt, now)}</strong>
          </span>
        </div>
        <button
          type="button"
          className={styles.completeButton}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          aria-label={`Mark ${task.title} complete`}
        >
          <Icon name="check" size={15} />
          Done
        </button>
      </footer>
    </article>
  );
}

function MinorTaskRow({
  task,
  now,
  onOpen,
  onToggle,
}: {
  task: WorkTask;
  now: Date;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <article className={styles.minorRow}>
      <button
        type="button"
        className={styles.taskCheckbox}
        onClick={onToggle}
        aria-label={`Mark ${task.title} complete`}
      >
        <Icon name="check" size={13} />
      </button>
      <button type="button" className={styles.minorBody} onClick={onOpen}>
        <span className={styles.minorTitle}>
          <strong>{task.title}</strong>
          {task.isSample ? <small>Sample</small> : null}
        </span>
        <span className={styles.minorMeta}>
          <span>{task.project}</span>
          <span
            className={styles.minorDue}
            data-urgency={getDueTone(task.dueAt, now)}
          >
            <Icon name="calendar" size={11} />
            {formatDue(task.dueAt, now)}
          </span>
        </span>
      </button>
      <SourceStack sourceIds={task.sourceIds} compact />
      <span className={styles.estimate}>{task.estimateMinutes}m</span>
      <button
        type="button"
        className={styles.rowOpen}
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
      >
        <Icon name="chevron-right" size={16} />
      </button>
    </article>
  );
}

function ScheduleRow({
  item,
  now,
  showDay,
}: {
  item: ScheduleItem;
  now: Date;
  showDay: boolean;
}) {
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const past = end.getTime() < now.getTime();

  return (
    <div className={`${styles.timelineRow} ${past ? styles.timelinePast : ""}`}>
      <div className={styles.timelineTime}>
        {showDay ? (
          <>
            <strong>
              {new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                timeZone: DISPLAY_TIME_ZONE,
              }).format(start)}
            </strong>
            <span>
              {new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                timeZone: DISPLAY_TIME_ZONE,
              }).format(start)}
            </span>
          </>
        ) : (
          <>
            <strong>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: DISPLAY_TIME_ZONE,
              }).format(start)}
            </strong>
            <span>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: DISPLAY_TIME_ZONE,
              })
                .format(end)
                .replace(/\s/g, "")}
            </span>
          </>
        )}
      </div>
      <span className={styles.timelineLine}>
        <span data-kind={item.kind} />
      </span>
      <div className={styles.timelineContent}>
        <strong>{item.title}</strong>
        <span>
          {item.kind === "focus"
            ? "Protected focus"
            : item.kind === "personal"
              ? "Personal"
              : `${item.attendees ?? 1} people`}
        </span>
      </div>
      <SourceMark sourceId={item.sourceId} small />
    </div>
  );
}

function SourceStack({
  sourceIds,
  compact = false,
}: {
  sourceIds: ConnectorId[];
  compact?: boolean;
}) {
  const unique = [...new Set(sourceIds)].slice(0, compact ? 2 : 3);
  return (
    <span className={styles.sourceStack} aria-label="Task sources">
      {unique.map((sourceId) => (
        <SourceMark
          key={sourceId}
          sourceId={sourceId}
          small={compact}
        />
      ))}
    </span>
  );
}

function SourceMark({
  sourceId,
  small = false,
}: {
  sourceId: ConnectorId;
  small?: boolean;
}) {
  return (
    <span
      className={`${styles.sourceMark} ${small ? styles.sourceMarkSmall : ""}`}
      data-source={sourceId}
      title={sourceNames[sourceId]}
      aria-label={sourceNames[sourceId]}
    >
      {sourceLetters[sourceId]}
    </span>
  );
}

function EmptyState({
  hasQuery,
  onClear,
  onAdd,
}: {
  hasQuery: boolean;
  onClear: () => void;
  onAdd: () => void;
}) {
  return (
    <div className={styles.emptyState}>
      <div>
        <Icon name={hasQuery ? "search" : "check"} size={22} />
      </div>
      <h3>{hasQuery ? "No priorities match" : "Your stack is clear"}</h3>
      <p>
        {hasQuery
          ? "Try another search or show every area."
          : "Add a commitment when something new needs your attention."}
      </p>
      <button type="button" onClick={hasQuery ? onClear : onAdd}>
        {hasQuery ? "Clear filters" : "Add a task"}
      </button>
    </div>
  );
}

function TaskDrawer({
  task,
  now,
  onClose,
  onToggle,
  onDefer,
}: {
  task: WorkTask;
  now: Date;
  onClose: () => void;
  onToggle: () => void;
  onDefer: () => void;
}) {
  const projection = projectTask(task, now);
  const drawerRef = useDialogFocus<HTMLElement>(onClose);

  return (
    <div className={styles.overlayLayer}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close task details"
      />
      <aside
        ref={drawerRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
      >
        <div className={styles.drawerHeader}>
          <div>
            <p>Task context</p>
            <span>{task.isSample ? "Sample evidence" : "Manual task"}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close task details">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.detailPills}>
            <span data-importance={task.importance}>{task.importance}</span>
            <span>{task.area}</span>
            <span>Priority {projection.priorityScore}/100</span>
            {projection.stale.isStale ? <span>Needs review</span> : null}
            {projection.dependencies.blockedBy.length ? (
              <span>Blocked</span>
            ) : null}
            {task.isSample ? <span>Sample</span> : null}
          </div>
          <p className={styles.detailProject}>{task.project}</p>
          <h2 id="task-drawer-title">{task.title}</h2>
          <p className={styles.detailRationale}>{task.rationale}</p>

          <div className={styles.priorityExplanation}>
            <div>
              <strong>Why this?</strong>
              <span>{projection.explanation.horizonReason}</span>
            </div>
            <p>{projection.explanation.summary}</p>
            <small>
              Each point shows how much that factor contributes to the priority
              score.
            </small>
            <ul>
              {projection.explanation.factors
                .filter((factor) => factor.points !== 0)
                .slice(0, 4)
                .map((factor) => (
                  <li key={factor.key}>
                    <span>{factor.label}</span>
                    <strong>
                      {factor.points > 0 ? "+" : ""}
                      {factor.points}
                    </strong>
                  </li>
                ))}
            </ul>
          </div>

          <div className={styles.detailFacts}>
            <div>
              <span>Due</span>
              <strong>{formatDue(task.dueAt, now, true)}</strong>
            </div>
            <div>
              <span>Effort</span>
              <strong>{formatDuration(task.estimateMinutes)}</strong>
            </div>
          </div>

          <div className={styles.evidenceHeading}>
            <div>
              <p>Why this surfaced</p>
              <span>
                {task.signals.length
                  ? `${task.signals.length} normalized signal${
                      task.signals.length === 1 ? "" : "s"
                    }`
                  : "No connected evidence"}
              </span>
            </div>
            <Icon name="sparkles" size={17} />
          </div>

          {task.signals.length ? (
            <div className={styles.evidenceList}>
              {task.signals.map((signal) => (
                <article key={signal.id}>
                  <SourceMark sourceId={signal.connectorId} />
                  <div>
                    <p>
                      {sourceNames[signal.connectorId]} · {signal.label}
                    </p>
                    <strong>{signal.detail}</strong>
                    <time dateTime={signal.occurredAt}>
                      {formatRelativeDate(signal.occurredAt, now)}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.noEvidence}>
              <Icon name="lock" size={18} />
              <p>
                This task was captured manually. No external context was
                accessed or inferred.
              </p>
            </div>
          )}

          {task.isSample ? (
            <div className={styles.sampleDisclosure}>
              These details demonstrate the prioritization model. They are not
              from a real account.
            </div>
          ) : null}
        </div>

        <div className={styles.drawerFooter}>
          {task.sourceUrl ? (
            <a
              className={styles.drawerSource}
              href={task.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open source
              <Icon name="arrow-right" size={14} />
            </a>
          ) : null}
          <button
            type="button"
            className={styles.drawerSecondary}
            onClick={onClose}
          >
            Close
          </button>
          {task.status !== "completed" ? (
            <button
              type="button"
              className={styles.drawerSecondary}
              onClick={() => {
                onDefer();
                onClose();
              }}
            >
              Defer to tomorrow
            </button>
          ) : null}
          <button
            type="button"
            className={styles.drawerPrimary}
            onClick={() => {
              onToggle();
              onClose();
            }}
          >
            <Icon name="check" size={16} />
            {task.status === "completed" ? "Restore task" : "Mark complete"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function SourcesDrawer({
  connectors,
  checkedAt,
  refreshing,
  onRefresh,
  onDisconnect,
  onImport,
  onClearLocal,
  localMode,
  onClose,
}: {
  connectors: PublicConnectorState[];
  checkedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: (connectorId: ConnectorId) => void;
  onImport: (
    connectorId: Extract<ConnectorId, "granola" | "linkedin">,
    file: File,
  ) => void;
  onClearLocal: () => void;
  localMode: boolean;
  onClose: () => void;
}) {
  const liveCount = connectors.filter(
    (connector) => connector.status === "connected",
  ).length;
  const authorizedCount = connectors.filter(
    (connector) => connector.status === "authorized",
  ).length;
  const drawerRef = useDialogFocus<HTMLElement>(onClose);

  return (
    <div className={styles.overlayLayer}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close sources"
      />
      <aside
        ref={drawerRef}
        className={`${styles.drawer} ${styles.sourcesDrawer}`}
        role="dialog"
        aria-modal="true"
        aria-busy={refreshing}
        aria-labelledby="sources-title"
      >
        <div className={styles.drawerHeader}>
          <div>
            <p id="sources-title">Sources</p>
            <span>Honest connection health</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close sources">
            <Icon name="close" />
          </button>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.connectionSummary}>
            <div className={styles.connectionSummaryIcon}>
              <Icon name="link" size={20} />
            </div>
            <div>
              <p>
                {liveCount
                  ? `${liveCount} source${liveCount === 1 ? "" : "s"} live`
                  : authorizedCount
                    ? `${authorizedCount} authorized · sync not live`
                    : "No external source is live"}
              </p>
              <span>
                Authorization, ingestion, and freshness are reported separately
                so setup is never mistaken for live data.
              </span>
            </div>
          </div>

          <div className={styles.connectorList}>
            {connectors.map((connector) => (
              <article key={connector.id}>
                <div className={styles.connectorTitle}>
                  <SourceMark sourceId={connector.id} />
                  <div>
                    <strong>{connector.label}</strong>
                    <span>{connector.description}</span>
                  </div>
                </div>
                <div className={styles.connectorState}>
                  <span data-status={connector.status} />
                  {connector.statusLabel}
                </div>
                <p>{connector.detail}</p>
                {connector.accountLabel ? (
                  <p className={styles.accountLabel}>
                    Authorized account: {connector.accountLabel}
                  </p>
                ) : null}
                <div className={styles.capabilityList}>
                  {connector.capabilities.map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
                {connector.callbackPath ? (
                  <p className={styles.callbackPath}>
                    Callback path: <code>{connector.callbackPath}</code>
                  </p>
                ) : null}
                {connector.blockers.length ? (
                  <div className={styles.blockerList}>
                    <strong>Configuration needed</strong>
                    {connector.blockers.map((blocker) => (
                      <code key={blocker}>{blocker}</code>
                    ))}
                  </div>
                ) : null}
                {connector.setupUrl ||
                connector.accountLabel ||
                connector.id === "granola" ||
                connector.id === "linkedin" ? (
                  <div className={styles.connectorActions}>
                    {connector.setupUrl ? (
                      <a href={connector.setupUrl}>
                        {connector.status === "ready_to_connect"
                          ? "Connect"
                          : "Reauthorize"}
                      </a>
                    ) : null}
                    {connector.accountLabel ? (
                      <button
                        type="button"
                        onClick={() => onDisconnect(connector.id)}
                      >
                        Delete local grant
                      </button>
                    ) : null}
                    {connector.id === "granola" ||
                    connector.id === "linkedin" ? (
                      <label className={styles.connectorImport}>
                        Import export
                        <input
                          type="file"
                          accept={
                            connector.id === "linkedin"
                              ? ".csv,text/csv"
                              : ".md,.txt,.json,text/plain,application/json"
                          }
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) onImport(connector.id, file);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>

          <div className={styles.securityNote}>
            <div>
              <Icon name="lock" size={17} />
            </div>
            <p>
              <strong>
                {localMode ? "Private on this Mac" : "Server-side by design"}
              </strong>
              {localMode
                ? "OAuth grants are encrypted in the local PGlite database. Polling happens from this app; no Morrow VM receives your source data."
                : "OAuth code is development-gated. Production connection remains blocked until authenticated tenancy, KMS-backed credentials, verified webhooks, revocation, and deletion controls exist."}
            </p>
          </div>
          <div className={styles.localDataControls}>
            <div>
              <strong>
                {localMode ? "Personal local workspace" : "Browser-local preview data"}
              </strong>
              <span>
                {localMode
                  ? "Manual tasks stay in this browser; connector grants and synced records stay in ./data/morrow."
                  : "Manual tasks in this MVP are not suitable for sensitive work."}
              </span>
            </div>
            <button type="button" onClick={onClearLocal}>
              Clear local workspace
            </button>
          </div>
        </div>

        <div className={styles.drawerFooter}>
          <p>
            Checked{" "}
            <time dateTime={checkedAt}>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: DISPLAY_TIME_ZONE,
              }).format(new Date(checkedAt))}
            </time>
          </p>
          <button
            type="button"
            className={styles.drawerPrimary}
            onClick={onRefresh}
            disabled={refreshing}
          >
            <Icon
              name="refresh"
              size={16}
              className={refreshing ? styles.spinning : ""}
            />
            {localMode ? "Sync now" : "Refresh status"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function AddTaskDialog({
  now,
  onClose,
  onSubmit,
}: {
  now: Date;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const modalRef = useDialogFocus<HTMLDivElement>(onClose);

  return (
    <div className={`${styles.overlayLayer} ${styles.modalLayer}`}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close add task dialog"
      />
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-task-title"
      >
        <div className={styles.modalHeader}>
          <div>
            <p>Manual capture</p>
            <h2 id="add-task-title">Add a commitment</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <label className={styles.field}>
            <span>What needs doing?</span>
            <input
              name="title"
              placeholder="e.g. Send the revised brief"
              autoFocus
              required
              maxLength={120}
            />
          </label>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Project</span>
              <input
                name="project"
                placeholder="Unsorted"
                maxLength={60}
              />
            </label>
            <label className={styles.field}>
              <span>Due date</span>
              <input
                name="dueDate"
                type="date"
                required
                defaultValue={toDateInput(now)}
              />
            </label>
          </div>

          <fieldset className={styles.importanceField}>
            <legend>Importance</legend>
            <label>
              <input
                type="radio"
                name="importance"
                value="major"
                defaultChecked
              />
              <span>
                <strong>Major</strong>
                <small>Moves an outcome</small>
              </span>
            </label>
            <label>
              <input type="radio" name="importance" value="minor" />
              <span>
                <strong>Minor</strong>
                <small>Keeps things moving</small>
              </span>
            </label>
          </fieldset>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Area</span>
              <select name="area" defaultValue="Work">
                <option>Work</option>
                <option>Personal</option>
                <option>Wellbeing</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Estimate</span>
              <select name="estimate" defaultValue="30">
                <option value="10">10 minutes</option>
                <option value="20">20 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">1 hour</option>
                <option value="90">1.5 hours</option>
                <option value="120">2 hours</option>
              </select>
            </label>
          </div>

          <div className={styles.localNote}>
            <Icon name="lock" size={15} />
            Saved only in this browser. Do not enter sensitive work content in
            the preview.
          </div>

          <div className={styles.modalActions}>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit">
              <Icon name="plus" size={16} />
              Add task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const containerRef = useRef<T>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement;
    const container = containerRef.current;
    if (!container) return;

    const selector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(selector),
    );
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const activeItems = Array.from(
        container?.querySelectorAll<HTMLElement>(selector) ?? [],
      );
      if (!activeItems.length) return;
      const first = activeItems[0];
      const last = activeItems[activeItems.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return containerRef;
}

function matchesQuery(task: WorkTask, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    task.title,
    task.project,
    task.area,
    task.rationale,
    ...task.signals.flatMap((signal) => [signal.label, signal.detail]),
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function getGreeting(now: Date) {
  const hour = now.getUTCHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return "0m";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatElapsedTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatClockTime(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(date));
}

function formatCountdown(startAt: string, now: Date, endAt?: string) {
  const distanceMinutes = Math.ceil(
    (new Date(startAt).getTime() - now.getTime()) / 60_000,
  );
  if (
    distanceMinutes <= 0 &&
    (!endAt || new Date(endAt).getTime() >= now.getTime())
  ) {
    return "Happening now";
  }
  if (distanceMinutes <= 0) return "Recently ended";
  if (distanceMinutes < 60) return `In ${distanceMinutes}m`;
  const hours = Math.floor(distanceMinutes / 60);
  const minutes = distanceMinutes % 60;
  return minutes ? `In ${hours}h ${minutes}m` : `In ${hours}h`;
}

function getDueTone(dueAt: string, now: Date) {
  const due = new Date(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setUTCHours(0, 0, 0, 0);
  const dayDifference = Math.round(
    (dueDay.getTime() - today.getTime()) / 86_400_000,
  );
  if (dayDifference === 0) return "today";
  if (dayDifference <= 2) return "soon";
  return "later";
}

function formatDue(dueAt: string, now: Date, long = false) {
  const due = new Date(dueAt);
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setUTCHours(0, 0, 0, 0);
  const dayDifference = Math.round(
    (dueDay.getTime() - today.getTime()) / 86400000,
  );
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(due);

  if (due.getTime() < now.getTime()) return `Overdue · ${time}`;
  if (dayDifference === 0) return `Today · ${time}`;
  if (dayDifference === 1) return `Tomorrow · ${time}`;
  return new Intl.DateTimeFormat("en-US", {
    weekday: long ? "long" : "short",
    month: long ? "long" : undefined,
    day: "numeric",
    hour: long ? "numeric" : undefined,
    minute: long ? "2-digit" : undefined,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(due);
}

function formatRelativeDate(date: string, now: Date) {
  const distance = now.getTime() - new Date(date).getTime();
  const hours = Math.max(0, Math.round(distance / 3600000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function toDateInput(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function tasksFromLinkedInCsv(text: string, now: Date): WorkTask[] {
  return parseConnectionsCsv(text)
    .slice(0, 50)
    .map((row, index) => {
      const fullName = `${row.firstName} ${row.lastName}`.trim();
      const sourceKey =
        row.profileUrl || row.email || `${fullName}:${row.company ?? ""}`;
      const dueAt = importedDueAt(now, (index % 14) + 1);
      return {
        id: `linkedin-import:${stableLocalId(sourceKey)}`,
        title: `Reconnect with ${cleanImportedText(fullName, 90)}`,
        project: cleanImportedText(row.company || "Relationships", 70),
        area: "Work",
        importance: "minor",
        status: "open",
        dueAt,
        estimateMinutes: 15,
        sourceIds: ["linkedin", "manual"],
        signals: [
          {
            id: `linkedin-import-signal:${stableLocalId(sourceKey)}`,
            connectorId: "linkedin",
            label: row.position || row.company || "LinkedIn connection",
            detail: row.connectedOn
              ? `Connected on ${row.connectedOn}.`
              : "Imported from your official LinkedIn Connections.csv export.",
            occurredAt: now.toISOString(),
          },
        ],
        rationale:
          "A relationship imported from LinkedIn is ready for a deliberate follow-up.",
        reasonCodes: ["manual_commitment", "imported_relationship"],
        sourceUrl: safeImportedProfileUrl(row.profileUrl),
        priority: {
          deadlineKind: "soft",
          deadlineConfidence: 0.8,
          impactLevel: 1,
          impactConfidence: 0.5,
          commitmentKind: "manual",
          commitmentConfidence: 1,
          accepted: true,
          lastUserTouchAt: now.toISOString(),
        },
        createdAt: now.toISOString(),
        isSample: false,
      } satisfies WorkTask;
    });
}

function tasksFromGranolaExport(
  text: string,
  fileName: string,
  now: Date,
): WorkTask[] {
  const candidates = new Set<string>();
  const checkboxPattern =
    /(?:^|\n)\s*(?:[-*]\s*)?\[\s\]\s+([^\n]{2,500})/g;
  const actionPattern =
    /(?:^|\n)\s*(?:[-*]\s*)?(?:action item|action|todo|next step)\s*:\s*([^\n]{2,500})/gi;
  for (const pattern of [checkboxPattern, actionPattern]) {
    for (const match of text.matchAll(pattern)) {
      const candidate = cleanImportedText(match[1] ?? "", 220);
      if (candidate) candidates.add(candidate);
    }
  }
  try {
    collectActionStrings(JSON.parse(text), candidates);
  } catch {
    // Markdown and text exports are expected to skip JSON parsing.
  }

  const project =
    cleanImportedText(fileName.replace(/\.[^.]+$/, ""), 70) ||
    "Meeting notes";
  return [...candidates].slice(0, 50).map((candidate, index) => {
    const sourceKey = `${fileName}:${candidate}`;
    const occurredAt = now.toISOString();
    return {
      id: `granola-import:${stableLocalId(sourceKey)}`,
      title: candidate,
      project,
      area: "Work",
      importance: "minor",
      status: "open",
      dueAt: importedDueAt(now, (index % 7) + 1),
      estimateMinutes: 20,
      sourceIds: ["granola", "manual"],
      signals: [
        {
          id: `granola-import-signal:${stableLocalId(sourceKey)}`,
          connectorId: "granola",
          label: "Imported meeting action",
          detail: `Found in ${cleanImportedText(fileName, 100)}.`,
          occurredAt,
        },
      ],
      rationale:
        "An unchecked action item imported from your Granola export.",
      reasonCodes: ["manual_commitment", "imported_meeting_action"],
      priority: {
        deadlineKind: "soft",
        deadlineConfidence: 0.8,
        impactLevel: 1,
        impactConfidence: 0.6,
        commitmentKind: "manual",
        commitmentConfidence: 1,
        accepted: true,
        lastUserTouchAt: occurredAt,
      },
      createdAt: occurredAt,
      isSample: false,
    } satisfies WorkTask;
  });
}

function collectActionStrings(value: unknown, output: Set<string>, key = "") {
  if (output.size >= 50) return;
  if (typeof value === "string") {
    if (/action|task|todo|next.?step/i.test(key)) {
      const candidate = cleanImportedText(value, 220);
      if (candidate) output.add(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectActionStrings(item, output, key));
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([childKey, childValue]) =>
    collectActionStrings(childValue, output, childKey),
  );
}

function cleanImportedText(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeImportedProfileUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      (host === "linkedin.com" || host.endsWith(".linkedin.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function stableLocalId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function importedDueAt(now: Date, dayOffset: number) {
  const due = new Date(now);
  due.setDate(due.getDate() + dayOffset);
  due.setHours(17, 0, 0, 0);
  return due.toISOString();
}

function isManualTask(task: WorkTask) {
  return (
    !task.isSample &&
    task.sourceIds.includes("manual")
  );
}

function mergeSyncedTasks(current: WorkTask[], incoming: WorkTask[]) {
  const currentById = new Map(current.map((task) => [task.id, task]));
  const synced = incoming.map((task) => {
    const existing = currentById.get(task.id);
    if (!existing) return task;
    return {
      ...task,
      status: existing.status,
      completedAt: existing.completedAt ?? null,
      deferredUntil: existing.deferredUntil ?? null,
      dueAt: existing.deferredUntil ? existing.dueAt : task.dueAt,
    };
  });
  return [...synced, ...current.filter(isManualTask)];
}

function isStoredTask(value: unknown): value is WorkTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<WorkTask>;
  const validSources: ConnectorId[] = [
    "gmail",
    "slack",
    "calendar",
    "drive",
    "notion",
    "granola",
    "linkedin",
    "manual",
    "webhook",
  ];
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.project === "string" &&
    typeof task.dueAt === "string" &&
    typeof task.createdAt === "string" &&
    typeof task.rationale === "string" &&
    typeof task.estimateMinutes === "number" &&
    Number.isFinite(task.estimateMinutes) &&
    Array.isArray(task.sourceIds) &&
    task.sourceIds.every((source) => validSources.includes(source)) &&
    Array.isArray(task.signals) &&
    task.signals.every(
      (signal) =>
        signal &&
        typeof signal.id === "string" &&
        typeof signal.label === "string" &&
        typeof signal.detail === "string" &&
        typeof signal.occurredAt === "string" &&
        validSources.includes(signal.connectorId),
    ) &&
    (task.importance === "major" || task.importance === "minor") &&
    (task.status === "open" || task.status === "completed") &&
    (task.area === "Work" ||
      task.area === "Personal" ||
      task.area === "Wellbeing")
  );
}

function isStoredSampleOverride(
  value: unknown,
): value is NonNullable<SavedWorkspace["sampleOverrides"]>[number] {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  return (
    typeof override.id === "string" &&
    (override.status === "open" || override.status === "completed") &&
    typeof override.dueAt === "string" &&
    (override.deferredUntil === null ||
      typeof override.deferredUntil === "string") &&
    (override.completedAt === null || typeof override.completedAt === "string")
  );
}
