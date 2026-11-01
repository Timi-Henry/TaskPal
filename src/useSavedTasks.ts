import { useCallback, useRef, useState } from "react";

export type Task = {
  id: string;
  title: string;
  completed: boolean;
};

type TaskState = {
  tasks: Task[];
  storageMessage: string | null;
};

export const TASKS_STORAGE_KEY = "taskpal.tasks.v1";

function isTask(value: unknown): value is Task {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "title" in value &&
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    "completed" in value &&
    typeof value.completed === "boolean"
  );
}

export function readSavedTasks(): TaskState {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
  } catch {
    return {
      tasks: [],
      storageMessage:
        "Browser storage is unavailable. Tasks in this session may not survive a reload.",
    };
  }

  if (raw === null) return { tasks: [], storageMessage: null };

  try {
    const stored: unknown = JSON.parse(raw);
    if (
      typeof stored !== "object" ||
      stored === null ||
      !("version" in stored) ||
      stored.version !== 1 ||
      !("tasks" in stored) ||
      !Array.isArray(stored.tasks) ||
      !stored.tasks.every(isTask)
    ) {
      throw new Error("Invalid saved task format");
    }
    const tasks = stored.tasks;
    if (new Set(tasks.map((task) => task.id)).size !== tasks.length) {
      throw new Error("Duplicate saved task IDs");
    }
    return { tasks, storageMessage: null };
  } catch {
    return {
      tasks: [],
      storageMessage:
        "Saved tasks could not be read. They have not been changed; adding a new task will replace that unreadable data.",
    };
  }
}

export function saveTasks(tasks: Task[]): string | null {
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify({ version: 1, tasks }));
    return null;
  } catch {
    return "Your latest task changes could not be saved. Keep this page open and check that browser storage is allowed and has space.";
  }
}

export function useSavedTasks() {
  const [state, setState] = useState<TaskState>(readSavedTasks);
  const latestTasks = useRef(state.tasks);

  const updateTasks = useCallback((transform: (tasks: Task[]) => Task[]) => {
    const tasks = transform(latestTasks.current);
    const storageMessage = saveTasks(tasks);
    latestTasks.current = tasks;
    setState({ tasks, storageMessage });
  }, []);

  return { tasks: state.tasks, storageMessage: state.storageMessage, updateTasks };
}
