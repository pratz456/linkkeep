"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Icon } from "@/components/workspace/icon";
import {
  formatHorizonRange,
  getCompletionStats,
  getHorizonEnd,
  groupByImportance,
  prioritizeTasks,
  scheduleForHorizon,
} from "@/lib/workspace/prioritize";
import type {
  ConnectorId,
  Horizon,
  PublicConnectorState,
  ScheduleItem,
  WorkArea,
  WorkTask,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";
import styles from "./workspace.module.css";

const STORAGE_KEY = "morrow-workspace-v1";

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
  granola: "Granola",
  manual: "Manual",
  webhook: "Webhook",
};

const sourceLetters: Record<ConnectorId, string> = {
  gmail: "M",
  slack: "S",
  calendar: "C",
  granola: "G",
  manual: "+",
  webhook: "W",
};

interface SavedWorkspace {
  completedIds: string[];
  customTasks: WorkTask[];
}

interface WorkspaceProps {
  initialSnapshot: WorkspaceSnapshot;
  initialConnectors: PublicConnectorState[];
}

export function Workspace({
  initialSnapshot,
  initialConnectors,
}: WorkspaceProps) {
  const now = useMemo(
    () => new Date(initialSnapshot.generatedAt),
    [initialSnapshot.generatedAt],
  );
  const [tasks, setTasks] = useState(initialSnapshot.tasks);
  const [connectors, setConnectors] = useState(initialConnectors);
  const [horizon, setHorizon] = useState<Horizon>("today");
  const [area, setArea] = useState<WorkArea | "All">("All");
  const [query, setQuery] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(initialSnapshot.generatedAt);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<SavedWorkspace>;
      const completedIds = Array.isArray(parsed.completedIds)
        ? parsed.completedIds.filter((id): id is string => typeof id === "string")
        : [];
      const customTasks = Array.isArray(parsed.customTasks)
        ? parsed.customTasks.filter(isStoredTask)
        : [];

      setTasks([
        ...initialSnapshot.tasks.map((task) =>
          completedIds.includes(task.id)
            ? { ...task, status: "completed" as const }
            : { ...task, status: "open" as const },
        ),
        ...customTasks,
      ]);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [initialSnapshot.tasks]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
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
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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

  const completedTasks = useMemo(() => {
    const horizonEnd = getHorizonEnd(horizon, now).getTime();
    return tasks
      .filter(
        (task) =>
          task.status === "completed" &&
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
  const connectedCount = connectors.filter(
    (connector) =>
      connector.status === "credentials_ready" ||
      connector.status === "local",
  ).length;

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
      customTasks: nextTasks.filter((task) => !task.isSample),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }

  function toggleTask(taskId: string) {
    setTasks((current) => {
      const next = current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: task.status === "completed" ? "open" : "completed",
            }
          : task,
      ) as WorkTask[];
      persist(next);
      return next;
    });
    setToast("Task updated");
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const dueDate = String(formData.get("dueDate") ?? "");
    if (!title || !dueDate) return;

    const dueAt = new Date(`${dueDate}T17:00:00`);
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
      const response = await fetch("/api/connectors", { cache: "no-store" });
      if (!response.ok) throw new Error("status request failed");
      const payload = (await response.json()) as {
        connectors?: PublicConnectorState[];
        checkedAt?: string;
      };
      if (!Array.isArray(payload.connectors)) throw new Error("invalid response");
      setConnectors(payload.connectors);
      setCheckedAt(payload.checkedAt ?? new Date().toISOString());
      setToast("Source status refreshed");
    } catch {
      setToast("Could not refresh source status");
    } finally {
      setRefreshing(false);
    }
  }

  function selectHorizon(nextHorizon: Horizon) {
    setHorizon(nextHorizon);
    setMobileNavOpen(false);
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
              <span className={styles.navCount}>
                {prioritizeTasks(tasks, item, now).length}
              </span>
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
                onClick={() => {
                  setArea(item);
                  setMobileNavOpen(false);
                }}
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
            <small>{connectedCount} available · no live sync</small>
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

      <div className={styles.appColumn}>
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
              placeholder="Search tasks and context"
              aria-label="Search tasks and context"
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
              <kbd>/</kbd>
            )}
          </label>

          <div className={styles.topbarActions}>
            <button
              type="button"
              className={styles.sourceButton}
              onClick={() => setSourcesOpen(true)}
            >
              <span className={styles.statusIndicator} />
              <span>Sources</span>
              <span className={styles.sourceCount}>{connectedCount}</span>
            </button>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setAddTaskOpen(true)}
            >
              <Icon name="plus" size={17} />
              <span>Add task</span>
            </button>
          </div>
        </header>

        <main id="workspace-main" className={styles.main}>
          <section className={styles.sampleNotice} aria-label="Preview status">
            <div className={styles.sampleIcon}>
              <Icon name="sparkles" size={16} />
            </div>
            <p>
              <strong>You&apos;re viewing sample context.</strong>{" "}
              <span>
                No email, Slack, calendar, or meeting data has been accessed.
              </span>
            </p>
            <button type="button" onClick={() => setSourcesOpen(true)}>
              Review sources <Icon name="arrow-right" size={14} />
            </button>
          </section>

          <section className={styles.pageHeading}>
            <div>
              <p className={styles.eyebrow}>{horizonCopy[horizon].label}</p>
              <h1>{horizonCopy[horizon].title}</h1>
              <p className={styles.headingNote}>{horizonCopy[horizon].note}</p>
            </div>
            <div className={styles.headingDate}>
              <span>{formatHorizonRange(horizon, now)}</span>
              <div className={styles.horizonTabs} aria-label="Change time range">
                {(["today", "week", "month"] as const).map((item) => (
                  <button
                    type="button"
                    key={item}
                    aria-pressed={horizon === item}
                    onClick={() => setHorizon(item)}
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

          <section className={styles.metrics} aria-label="Focus summary">
            <Metric
              label="Major priorities"
              value={String(groupedTasks.major.length)}
              note={
                groupedTasks.major.length > 2
                  ? "Worth narrowing"
                  : "A focused load"
              }
              icon="target"
              tone="coral"
            />
            <Metric
              label="Open effort"
              value={formatDuration(openMinutes)}
              note={`${openTasks.length} open commitments`}
              icon="clock"
              tone="blue"
            />
            <Metric
              label="Focus protected"
              value={formatDuration(focusMinutes)}
              note={`${meetingCount} meeting${meetingCount === 1 ? "" : "s"}`}
              icon="calendar"
              tone="green"
            />
            <Metric
              label="Progress"
              value={`${stats.percent}%`}
              note={`${stats.completed} of ${stats.total} complete`}
              icon="check"
              tone="gold"
              progress={stats.percent}
            />
          </section>

          <div className={styles.contentGrid}>
            <section className={styles.priorityPanel}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.sectionKicker}>Priority stack</p>
                  <h2>What deserves your attention</h2>
                </div>
                <span className={styles.sectionCount}>
                  {filteredTasks.length} open
                </span>
              </div>

              {filteredTasks.length ? (
                <>
                  <div className={styles.majorStack}>
                    {groupedTasks.major.map((task, index) => (
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

                  {groupedTasks.minor.length ? (
                    <div className={styles.minorSection}>
                      <div className={styles.minorHeading}>
                        <div>
                          <span className={styles.minorMarker} />
                          <h3>Smaller moves</h3>
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
                        {groupedTasks.minor.map((task) => (
                          <MinorTaskRow
                            key={task.id}
                            task={task}
                            now={now}
                            onOpen={() => setSelectedTaskId(task.id)}
                            onToggle={() => toggleTask(task.id)}
                          />
                        ))}
                      </div>
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
                  <span className={styles.liveLabel}>Sample</span>
                </div>
                {schedule.length ? (
                  <div className={styles.timeline}>
                    {schedule.slice(0, horizon === "today" ? 6 : 7).map((item) => (
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
                <div className={styles.scheduleFooter}>
                  <Icon name="lock" size={14} />
                  Calendar is not connected
                </div>
              </section>

              <section className={styles.contextPanel}>
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

              <section className={styles.balanceCard}>
                <div className={styles.balanceIcon}>
                  <Icon name="sparkles" size={17} />
                </div>
                <div>
                  <p>Balance note</p>
                  <h3>
                    {areaCounts.Wellbeing
                      ? "Personal commitments have a place here."
                      : "Leave room for life outside work."}
                  </h3>
                  <span>
                    Morrow never lowers a personal task simply because it came
                    from manual capture.
                  </span>
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>

      {selectedTask ? (
        <TaskDrawer
          task={selectedTask}
          now={now}
          onClose={() => setSelectedTaskId(null)}
          onToggle={() => toggleTask(selectedTask.id)}
        />
      ) : null}

      {sourcesOpen ? (
        <SourcesDrawer
          connectors={connectors}
          checkedAt={checkedAt}
          refreshing={refreshing}
          onRefresh={() => void refreshConnectors()}
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
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon,
  tone,
  progress,
}: {
  label: string;
  value: string;
  note: string;
  icon: "target" | "clock" | "calendar" | "check";
  tone: "coral" | "blue" | "green" | "gold";
  progress?: number;
}) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricIcon} data-tone={tone}>
        <Icon name={icon} size={17} />
      </div>
      <div className={styles.metricContent}>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
      {typeof progress === "number" ? (
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${Math.max(4, progress)}%` }} />
        </div>
      ) : null}
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
              }`
            : "Manual context"}
        </span>
      </div>
      <footer className={styles.majorFooter}>
        <div>
          <span>
            <Icon name="clock" size={14} />
            {formatDuration(task.estimateMinutes)}
          </span>
          <span>{formatDue(task.dueAt, now)}</span>
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
          <span>·</span>
          <span>{formatDue(task.dueAt, now)}</span>
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
              {new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
                start,
              )}
            </strong>
            <span>
              {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
                start,
              )}
            </span>
          </>
        ) : (
          <>
            <strong>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
              }).format(start)}
            </strong>
            <span>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
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
}: {
  task: WorkTask;
  now: Date;
  onClose: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={styles.overlayLayer}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close task details"
      />
      <aside
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
            {task.isSample ? <span>Sample</span> : null}
          </div>
          <p className={styles.detailProject}>{task.project}</p>
          <h2 id="task-drawer-title">{task.title}</h2>
          <p className={styles.detailRationale}>{task.rationale}</p>

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
          <button
            type="button"
            className={styles.drawerSecondary}
            onClick={onClose}
          >
            Close
          </button>
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
  onClose,
}: {
  connectors: PublicConnectorState[];
  checkedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.overlayLayer}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close sources"
      />
      <aside
        className={`${styles.drawer} ${styles.sourcesDrawer}`}
        role="dialog"
        aria-modal="true"
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
              <p>No external source is live</p>
              <span>
                This MVP exposes connector readiness without pretending to sync
                data it cannot access.
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
                <div className={styles.capabilityList}>
                  {connector.capabilities.map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className={styles.securityNote}>
            <div>
              <Icon name="lock" size={17} />
            </div>
            <p>
              <strong>Server-side by design</strong>
              OAuth secrets and provider tokens belong in encrypted server
              storage. The browser receives only redacted status metadata and
              normalized work signals.
            </p>
          </div>
        </div>

        <div className={styles.drawerFooter}>
          <p>
            Checked{" "}
            <time dateTime={checkedAt}>
              {new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
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
            Refresh status
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
  return (
    <div className={`${styles.overlayLayer} ${styles.modalLayer}`}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        aria-label="Close add task dialog"
      />
      <div
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
            Saved only in this browser for the MVP.
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

function formatDuration(minutes: number) {
  if (minutes <= 0) return "0m";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatDue(dueAt: string, now: Date, long = false) {
  const due = new Date(dueAt);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due);
  dueDay.setHours(0, 0, 0, 0);
  const dayDifference = Math.round(
    (dueDay.getTime() - today.getTime()) / 86400000,
  );
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(due);

  if (dayDifference < 0) return `Overdue · ${time}`;
  if (dayDifference === 0) return `Today · ${time}`;
  if (dayDifference === 1) return `Tomorrow · ${time}`;
  return new Intl.DateTimeFormat("en-US", {
    weekday: long ? "long" : "short",
    month: long ? "long" : undefined,
    day: "numeric",
    hour: long ? "numeric" : undefined,
    minute: long ? "2-digit" : undefined,
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isStoredTask(value: unknown): value is WorkTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<WorkTask>;
  const validSources: ConnectorId[] = [
    "gmail",
    "slack",
    "calendar",
    "granola",
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
