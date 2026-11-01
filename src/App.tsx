import { useLayoutEffect, useRef, useState, type SubmitEvent } from "react";
import { Check, Plus, Sparkles, Trash2 } from "lucide-react";
import ShaderBackground from "./components/ShaderBackground";
import TaskDetailsDialog from "./components/TaskDetailsDialog";
import { useSavedTasks, type Task } from "./useSavedTasks";

function shortLabel(value: string) {
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

export default function App() {
  const { tasks, updateTasks, storageMessage } = useSavedTasks();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<{ id: string | null } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const target = pending.id ? toggleRefs.current.get(pending.id) : null;
    (target ?? inputRef.current)?.focus();
  }, [tasks]);

  const completedCount = tasks.filter((task) => task.completed).length;

  const progress = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  function handleAddTask(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setError("Please enter a task title.");
      return;
    }

    updateTasks((currentTasks) => [
      ...currentTasks,
      {
        id: crypto.randomUUID(),
        title: trimmedTitle,
        completed: false,
      },
    ]);

    setTitle("");
    setError("");
    setAnnouncement("Task added.");
    inputRef.current?.focus();
  }

  function handleToggleTask(id: string) {
    updateTasks((currentTasks) =>
      currentTasks.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)),
    );
  }

  function handleDeleteTask(id: string) {
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) return;
    const adjacent = tasks[index + 1] ?? tasks[index - 1];
    pendingFocus.current = { id: adjacent?.id ?? null };
    updateTasks((currentTasks) => currentTasks.filter((task) => task.id !== id));
    setAnnouncement("Task deleted.");
  }

  return (
    <main className="taskpal-page min-h-screen bg-transparent px-4 py-7 sm:px-6 sm:py-10">
      <div className="taskpal-layout mx-auto w-full max-w-162.5">
        {/* Brand */}
        <header className="taskpal-brand flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={21} strokeWidth={1.8} className="text-[#25473b]" />

            <span className="text-[22px] font-bold tracking-[-0.8px]">
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

            <span className="font-hero-bottom text-[36px] font-light italic leading-[1.1] tracking-normal text-[#c97743] sm:text-[50px]">
              With TaskPal.
            </span>
          </h1>
        </section>

        <section
          aria-label="Today's progress"
          className="taskpal-progress mt-7 rounded-2xl border border-[#e3dfd3] bg-[#fffdf7] p-4.5 shadow-[0_5px_20px_#5b513212]"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] tracking-[0.7px] text-[#535b50]">TODAY'S PROGRESS</span>

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

        <form onSubmit={handleAddTask} className="taskpal-entry mt-4.5 flex gap-2">
          <input
            id="new-task"
            name="taskTitle"
            ref={inputRef}
            type="text"
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

          <button type="submit" className="task-add">
            <Plus size={16} />
            Add
          </button>
        </form>
        <p id="task-help" className="mt-2 text-xs text-[#535b50]">
          Select a task to read its full text.
        </p>
        {error && (
          <p id="task-error" role="alert" className="mt-2 text-sm text-[#a93620]">
            {error}
          </p>
        )}

        <section className="taskpal-tasks mt-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[34px] leading-tight text-[#272d27]">
              Today's <em>tasks.</em>
            </h2>

            <span className="text-[10px] tracking-wide text-[#535b50]">{tasks.length} TOTAL</span>
          </div>

          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id} className="task-card cutting-mat">
                {storageMessage && (
                  <p role="alert" className="mt-3 text-sm text-[#a93620]">
                    {storageMessage}
                  </p>
                )}

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
        <p className="sr-only" role="status">
          {announcement}
        </p>
      </div>
      <TaskDetailsDialog text={selectedTask?.title ?? null} onClose={() => setSelectedTask(null)} />
    </main>
  );
}
