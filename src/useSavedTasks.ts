import { useState, useSyncExternalStore } from "react";
import { createTaskRepository, type Task } from "./taskStorage";

export type { Task } from "./taskStorage";

export function useSavedTasks() {
  const [repository] = useState(createTaskRepository);
  const snapshot = useSyncExternalStore(repository.subscribe, repository.getSnapshot);

  return {
    ...snapshot,
    addTask: async (title: string) => {
      const task: Task = { id: crypto.randomUUID(), title: title.trim(), completed: false };
      await repository.add(task);
      return task;
    },
    toggleTask: repository.toggle,
    deleteTask: repository.delete,
    restoreTask: repository.restore,
    importTasks: repository.importTasks,
    retrySave: repository.retry,
    dismissRecovery: repository.dismissRecovery,
  };
}
