import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SubmitEvent,
} from "react";
import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import ShaderBackground from "./components/ShaderBackground";
import TaskDetailsDialog from "./components/TaskDetailsDialog";
import { useSavedTasks, type Task } from "./useSavedTasks";
import { createTaskBackup, parseTaskBackup } from "./taskStorage";

function shortLabel(value: string) {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const {
    tasks,
    status,
    storageMessage,
    recovery,
    addTask,
    toggleTask,
    deleteTask,
    restoreTask,
    importTasks,
    retrySave,
    dismissRecovery,
  } = useSavedTasks();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState({ id: 0, message: "" });
  const [undo, setUndo] = useState<{
    task: Task;
    index: number;
    anchors: { previousId: string | null; nextId: string | null };
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string | null } | null>(null);

  function announce(message: string) {
    setAnnouncement((current) => ({ id: current.id + 1, message }));
  }

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [undo]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const target = pending.id ? toggleRefs.current.get(pending.id) : null;
    (target ?? inputRef.current)?.focus();
  }, [tasks]);

  const completedCount = tasks.filter((task) => task.completed).length;

  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  async function handleAddTask(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading" || submitting.current) return;

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError("Please enter a task title.");
      inputRef.current?.focus();
      return;
    }

    submitting.current = true;
    setAdding(true);
    try {
      await addTask(trimmedTitle);
      setTitle("");
      setError("");
      announce("Task added.");
    } catch {
      setError("Your task could not be added. Keep the title here and try again.");
    } finally {
      submitting.current = false;
      setAdding(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function handleToggleTask(id: string) {
    void toggleTask(id);
  }

  function handleDeleteTask(id: string) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    const adjacent = tasks[index + 1] ?? tasks[index - 1];
    pendingFocus.current = { id: adjacent?.id ?? null };
    const task = tasks[index];
    const anchors = {
      previousId: tasks[index - 1]?.id ?? null,
      nextId: tasks[index + 1]?.id ?? null,
    };
    void deleteTask(id).then(() => {
      setUndo({ task, index, anchors });
      announce("Task deleted. Undo is available for eight seconds.");
    });
  }

  async function handleUndo() {
    if (!undo) return;
    pendingFocus.current = { id: undo.task.id };
    await restoreTask(undo.task, undo.index, undo.anchors);
    setUndo(null);
    announce("Task restored.");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBackupMessage("");
    setBackupError("");
    try {
      const imported = parseTaskBackup(await file.text());
      await importTasks(imported);
      setBackupMessage("Backup imported. Existing matching tasks were kept.");
      announce("Task backup imported.");
    } catch {
      setBackupError(
        "That file is not a valid TaskPal backup. Your current tasks have not been changed.",
      );
    } finally {
      input.value = "";
    }
  }

  return (
    <main className="taskpal-page min-h-screen bg-transparent px-4 py-7 sm:px-6 sm:py-10">
      <div className="taskpal-layout mx-auto w-full max-w-162.5">
        <header className="taskpal-brand flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={29} strokeWidth={1.8} className="text-[#263b31]" />

            <span className="text-[29px] font-bold tracking-[-0.8px]">
              TaskPal
              <span className="text-[#c97743]">.</span>
            </span>
          </div>
        </header>

        <section className="taskpal-hero mt-12 sm:mt-16">
          <p className="mb-3 text-[10px] font-bold tracking-[1.8px] text-[#535b50]">
            YOUR GO-TO TASK MANAGER
          </p>

          <h1 className="flex flex-col items-start">
            <span className="font-hero-top text-[28px] font-bold uppercase leading-[1.3] tracking-[0.08em] text-[#263b31] sm:text-[45px]">
              Get More Done
            </span>

            <span className="font-hero-bottom text-[36px] font-normal italic leading-[1.1] tracking-normal text-[#9b4f28] sm:text-[50px]">
              With TaskPal.
            </span>
          </h1>
        </section>

        <div className="taskpal-progress-area">
          <a className="taskpal-guide-link" href="/help.html">
            How To Use TaskPal
          </a>
          <section
            aria-label="Your progress"
            className="taskpal-progress rounded-2xl border border-[#e3dfd3] bg-[#fffdf7] p-4.5 shadow-[0_5px_20px_#5b513212]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] tracking-[0.7px] text-[#535b50]">YOUR PROGRESS</span>

              <span className="text-[13px] font-semibold text-[#9b4f28]">{progress}%</span>
            </div>

            <p className="mt-3 flex items-baseline gap-1.5 text-[13px] text-[#535b50]">
              <span className="font-display text-[39px] leading-none text-[#242923]">
                {completedCount}
              </span>
              of {tasks.length} tasks completed
            </p>

            <div
              role="progressbar"
              aria-label="Task completion"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#e9e3d9]"
            >
              <div
                className="h-full rounded-full bg-[#c97743] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </section>
        </div>

        <form onSubmit={handleAddTask} className="taskpal-entry mt-4.5 flex gap-2">
          <input
            id="new-task"
            name="taskTitle"
            ref={inputRef}
            type="text"
            autoComplete="off"
            disabled={adding}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);

              if (error) {
                setError("");
              }
            }}
            placeholder="Add Task Here"
            aria-label="New task"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "task-help task-error" : "task-help"}
            className="task-input"
          />

          <button type="submit" className="task-add" disabled={status === "loading" || adding}>
            <Plus size={16} />
            Add
          </button>
        </form>
        <p id="task-help" className="mt-2 text-xs text-[#535b50]">
          Select a task to read its full text.
        </p>
        <div className="taskpal-notices">
          {error && (
            <p id="task-error" role="alert" className="mt-2 text-sm text-[#a93620]">
              {error}
            </p>
          )}
          {storageMessage && (
            <div className="task-storage-alert" role="alert">
              <p>{storageMessage}</p>
              <div className="task-storage-actions">
                {(status === "unsaved" || status === "unavailable") && (
                  <button type="button" onClick={() => void retrySave()}>
                    Retry saving
                  </button>
                )}
                {recovery && (
                  <>
                    <button
                      type="button"
                      onClick={() => downloadText("taskpal-previous-data.json", recovery.raw)}
                    >
                      Download previous data
                    </button>
                    <button type="button" onClick={() => void dismissRecovery()}>
                      Keep current tasks
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {undo && (
            <div className="task-undo">
              <span>Task deleted.</span>
              <button type="button" aria-label="Undo delete" onClick={() => void handleUndo()}>
                Undo
              </button>
            </div>
          )}
        </div>

        <section className="taskpal-tasks mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[34px] leading-tight text-[#272d27]">
              Your <em>tasks.</em>
            </h2>

            <span className="text-[12px] tracking-wide text-[#000000]">{tasks.length} TOTAL</span>
          </div>

          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id} className="task-card cutting-mat">
                <div className="shader-spot">
                  <ShaderBackground />
                </div>

                <button
                  type="button"
                  ref={(node) => {
                    if (node) toggleRefs.current.set(task.id, node);
                    else toggleRefs.current.delete(task.id);
                  }}
                  onClick={() => handleToggleTask(task.id)}
                  aria-label={
                    task.completed
                      ? `Mark ${shortLabel(task.title)} incomplete`
                      : `Mark ${shortLabel(task.title)} complete`
                  }
                  aria-pressed={task.completed}
                  className="task-toggle task-card-content"
                >
                  {task.completed && <Check size={16} strokeWidth={2.5} />}
                </button>

                <button
                  type="button"
                  className="task-open"
                  aria-label={`Open full task: ${shortLabel(task.title)}`}
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setSelectedTask(task);
                  }}
                >
                  <span
                    className={`task-title task-card-content${task.completed ? " task-title-completed" : ""}`}
                  >
                    {task.title}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDeleteTask(task.id)}
                  aria-label={`Delete ${shortLabel(task.title)}`}
                  className="task-delete task-card-content"
                >
                  <Trash2 size={16} strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>

          {tasks.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[#c9c7b9] bg-[#fffdf7] px-5 py-9 text-center">
              <p className="font-display text-2xl text-[#272d27]">No tasks so far.</p>
              <p className="mt-2 text-[13px] text-[#535b50]">Add your first task to get started.</p>
            </div>
          )}
        </section>
        <footer className="taskpal-footer">
          <details className="task-data-tools">
            <summary>Backup &amp; storage</summary>
            <p>
              {status === "loading"
                ? "Loading saved tasks…"
                : status === "saved"
                  ? "Saved in this browser. Export a backup to keep another copy."
                  : "Some changes are not saved. Export a backup before closing this tab."}
            </p>
            <div className="task-data-actions">
              <button
                type="button"
                disabled={status === "loading"}
                onClick={() => downloadText("taskpal-backup.json", createTaskBackup(tasks))}
              >
                Export tasks
              </button>
              <label>
                Import tasks
                <input
                  type="file"
                  aria-label="Import tasks"
                  accept=".json,application/json"
                  disabled={status === "loading"}
                  onChange={(event) => void handleImport(event)}
                />
              </label>
            </div>
            {backupMessage && <p role="status">{backupMessage}</p>}
            {backupError && <p role="alert">{backupError}</p>}
          </details>
          <nav aria-label="Information">
            <a href="/privacy.html">Data &amp; Privacy</a>
          </nav>
        </footer>
        <p className="sr-only" role="status">
          <span key={announcement.id}>{announcement.message}</span>
        </p>
      </div>
      <TaskDetailsDialog text={selectedTask?.title ?? null} onClose={() => setSelectedTask(null)} />
    </main>
  );
}
