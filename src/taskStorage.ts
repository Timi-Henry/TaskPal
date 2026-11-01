export type Task = { id: string; title: string; completed: boolean };
type StoredTask = Task & { order: number };
type Operation = (tasks: StoredTask[]) => StoredTask[];
export type TaskSnapshot = {
  tasks: Task[];
  status: "loading" | "saved" | "unsaved" | "unavailable";
  storageMessage: string | null;
  recovery: { raw: string; reason: string } | null;
};
type Options = {
  databaseName?: string;
  indexedDB?: IDBFactory | null;
  storage?: Pick<Storage, "getItem"> | null;
  channelFactory?: (name: string) => BroadcastChannel | null;
};
export const LEGACY_STORAGE_KEY = "taskpal.tasks.v1";
const SAVE_FAILURE =
  "Your latest changes are not saved. Keep this tab open, export a backup, and retry saving.";
const LOAD_FAILURE =
  "Browser storage is unavailable. Tasks added in this tab may not survive a reload. Export a backup before closing it.";

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
function copyTask(task: Task): Task {
  return { id: task.id, title: task.title, completed: task.completed };
}
export function parseTaskBackup(raw: string): Task[] {
  const data: unknown = JSON.parse(raw);
  if (
    typeof data !== "object" ||
    data === null ||
    !("version" in data) ||
    data.version !== 1 ||
    !("tasks" in data) ||
    !Array.isArray(data.tasks) ||
    !data.tasks.every(isTask) ||
    new Set(data.tasks.map((task) => task.id)).size !== data.tasks.length
  ) {
    throw new Error("Choose a valid TaskPal backup with unique task IDs and nonempty titles.");
  }
  return data.tasks.map(copyTask);
}
export function createTaskBackup(tasks: Task[]): string {
  return JSON.stringify({ version: 1, tasks: tasks.map(copyTask) }, null, 2);
}
function sortTasks(tasks: StoredTask[]) {
  return tasks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
function appendTasks(current: StoredTask[], additions: Task[]) {
  const ids = new Set(current.map((task) => task.id));
  let order = current.reduce((highest, task) => Math.max(highest, task.order), -1);
  return [
    ...current,
    ...additions
      .filter((task) => !ids.has(task.id))
      .map((task) => ({ ...copyTask(task), order: ++order })),
  ];
}

export function createTaskRepository(options: Options = {}) {
  const name = options.databaseName ?? "taskpal.tasks.v2";
  const factory = options.indexedDB === undefined ? globalThis.indexedDB : options.indexedDB;
  let snapshot: TaskSnapshot = {
    tasks: [],
    status: "loading",
    storageMessage: null,
    recovery: null,
  };
  let records: StoredTask[] = [];
  let database: IDBDatabase | null = null;
  let channel: BroadcastChannel | null = null;
  let loaded: Promise<void> | undefined;
  let queue = Promise.resolve();
  let journal: Operation[] = [];
  let disposed = false;
  let listening = false;
  let legacyWarning: string | null = null;
  let disposalTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(status: TaskSnapshot["status"], message?: string | null) {
    snapshot = {
      tasks: records.map(copyTask),
      status,
      storageMessage: message === undefined ? legacyWarning : message,
      recovery: snapshot.recovery,
    };
    for (const listener of listeners) listener();
  }
  function legacyData() {
    try {
      const storage = options.storage === undefined ? globalThis.localStorage : options.storage;
      const raw = storage?.getItem(LEGACY_STORAGE_KEY) ?? null;
      if (raw === null) return { tasks: [], recovery: null, warning: null };
      try {
        return { tasks: parseTaskBackup(raw), recovery: null, warning: null };
      } catch {
        const reason =
          "Previous saved data could not be read. It has been preserved. Download it for recovery, or keep the current tasks.";
        return { tasks: [], recovery: { raw, reason }, warning: reason };
      }
    } catch {
      return {
        tasks: [],
        recovery: null,
        warning:
          "Previous saved data could not be checked. Allow browser storage and retry before closing any older TaskPal tabs.",
      };
    }
  }
  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (!factory) return reject(new Error("IndexedDB unavailable"));
      const request = factory.open(name, 1);
      let settled = false;
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error("Storage connection timed out"));
      }, 4000);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("tasks"))
          db.createObjectStore("tasks", { keyPath: "id" });
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      };
      request.onerror = () => {
        clearTimeout(timeout);
        settled = true;
        reject(request.error ?? new Error("Storage connection failed"));
      };
      request.onblocked = () => {
        clearTimeout(timeout);
        settled = true;
        reject(new Error("Close older TaskPal tabs and retry"));
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (settled || disposed) {
          request.result.close();
          if (!settled) reject(new Error("Repository closed"));
          return;
        }
        settled = true;
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (database === db) database = null;
          publish(journal.length ? "unsaved" : "unavailable", LOAD_FAILURE);
        };
        resolve(db);
      };
    });
  }
  function readRecords(): Promise<StoredTask[]> {
    return new Promise((resolve, reject) => {
      if (!database) return reject(new Error("Storage unavailable"));
      const tx = database.transaction("tasks", "readonly");
      const request = tx.objectStore("tasks").getAll();
      tx.oncomplete = () => resolve(sortTasks(request.result as StoredTask[]));
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Read failed"));
    });
  }
  async function initializeDatabase() {
    database = await openDatabase();
    const previous = legacyData();
    return new Promise<StoredTask[]>((resolve, reject) => {
      const tx = database!.transaction(["tasks", "meta"], "readwrite");
      const store = tx.objectStore("tasks");
      const meta = tx.objectStore("meta");
      const existing = store.getAll();
      const marker = meta.get("legacy-imported");
      let next: StoredTask[] = [];
      let ready = 0;
      const prepare = () => {
        if (++ready !== 2) return;
        next = sortTasks(existing.result as StoredTask[]);
        if (marker.result) {
          snapshot = { ...snapshot, recovery: null };
          legacyWarning = null;
          return;
        }
        snapshot = { ...snapshot, recovery: previous.recovery };
        legacyWarning = previous.warning;
        if (previous.warning) return;
        const imported = appendTasks(next, previous.tasks);
        const ids = new Set(next.map((task) => task.id));
        for (const task of imported) if (!ids.has(task.id)) store.put(task);
        next = imported;
        meta.put({ key: "legacy-imported", value: true });
      };
      existing.onsuccess = marker.onsuccess = prepare;
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Migration failed"));
    });
  }
  function commit(): Promise<StoredTask[]> {
    return new Promise((resolve, reject) => {
      if (!database) return reject(new Error("Storage unavailable"));
      const tx = database.transaction("tasks", "readwrite");
      const store = tx.objectStore("tasks");
      const request = store.getAll();
      let next: StoredTask[] = [];
      request.onsuccess = () => {
        const before = sortTasks(request.result as StoredTask[]);
        next = journal.reduce((tasks, operation) => operation(tasks), before);
        const oldById = new Map(before.map((task) => [task.id, task]));
        const remaining = new Set(next.map((task) => task.id));
        for (const task of before) if (!remaining.has(task.id)) store.delete(task.id);
        for (const task of next) {
          const old = oldById.get(task.id);
          if (
            !old ||
            old.title !== task.title ||
            old.completed !== task.completed ||
            old.order !== task.order
          )
            store.put(task);
        }
      };
      tx.oncomplete = () => resolve(next);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Save failed"));
    });
  }
  function signal() {
    try {
      channel?.postMessage("changed");
    } catch {
      return;
    }
  }
  function enqueue(work: () => Promise<void>) {
    queue = queue.then(work, work);
    return queue;
  }
  function refresh() {
    void enqueue(async () => {
      await load();
      if (!database || disposed) return;
      try {
        records = journal.reduce((tasks, operation) => operation(tasks), await readRecords());
        publish(journal.length ? "unsaved" : "saved", journal.length ? SAVE_FAILURE : undefined);
      } catch {
        publish(
          journal.length ? "unsaved" : "unavailable",
          journal.length ? SAVE_FAILURE : LOAD_FAILURE,
        );
      }
    });
  }
  function visibilityChanged() {
    if (!document.hidden) refresh();
  }
  function startListening() {
    if (listening) return;
    listening = true;
    try {
      channel = options.channelFactory
        ? options.channelFactory(name)
        : typeof BroadcastChannel === "undefined"
          ? null
          : new BroadcastChannel(name);
      channel?.addEventListener("message", refresh);
    } catch {
      channel = null;
    }
    if (typeof window !== "undefined") window.addEventListener("focus", refresh);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", visibilityChanged);
  }
  function load() {
    if (!loaded) {
      disposed = false;
      startListening();
      loaded = initializeDatabase()
        .then((tasks) => {
          records = tasks;
          publish("saved");
        })
        .catch(() => {
          database?.close();
          database = null;
          const previous = legacyData();
          records = appendTasks(records, previous.tasks);
          snapshot = { ...snapshot, recovery: previous.recovery };
          publish(
            "unavailable",
            previous.warning ? `${LOAD_FAILURE} ${previous.warning}` : LOAD_FAILURE,
          );
        });
    }
    return loaded;
  }
  function mutate(operation: Operation) {
    return enqueue(async () => {
      await load();
      journal.push(operation);
      const next = operation(records);
      try {
        records = await commit();
        journal = [];
        publish("saved");
        signal();
      } catch {
        records = next;
        publish("unsaved", SAVE_FAILURE);
      }
    });
  }
  function dispose() {
    disposed = true;
    clearTimeout(disposalTimer);
    channel?.removeEventListener("message", refresh);
    channel?.close();
    channel = null;
    database?.close();
    database = null;
    loaded = undefined;
    listening = false;
    if (typeof window !== "undefined") window.removeEventListener("focus", refresh);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", visibilityChanged);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      clearTimeout(disposalTimer);
      listeners.add(listener);
      void load();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) disposalTimer = setTimeout(dispose, 0);
      };
    },
    load,
    add: (task: Task) => {
      if (!isTask(task)) return Promise.reject(new Error("Invalid task"));
      const saved = copyTask(task);
      return mutate((tasks) => appendTasks(tasks, [saved]));
    },
    toggle: (id: string) => {
      return mutate((tasks) =>
        tasks.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task)),
      );
    },
    delete: (id: string) => {
      return mutate((tasks) => tasks.filter((task) => task.id !== id));
    },
    restore: (
      task: Task,
      index: number,
      anchors?: { previousId: string | null; nextId: string | null },
    ) => {
      if (!isTask(task)) return Promise.reject(new Error("Invalid task"));
      const saved = copyTask(task);
      return mutate((tasks) => {
        if (tasks.some((current) => current.id === saved.id)) return tasks;
        const nextIndex = anchors?.nextId
          ? tasks.findIndex((current) => current.id === anchors.nextId)
          : -1;
        const previousIndex = anchors?.previousId
          ? tasks.findIndex((current) => current.id === anchors.previousId)
          : -1;
        const position =
          nextIndex >= 0 ? nextIndex : previousIndex >= 0 ? previousIndex + 1 : index;
        const at = Math.max(0, Math.min(position, tasks.length));
        const before = tasks[at - 1]?.order,
          after = tasks[at]?.order;
        const order =
          before === undefined
            ? (after ?? 0) - 1
            : after === undefined
              ? before + 1
              : (before + after) / 2;
        return sortTasks([...tasks, { ...saved, order }]);
      });
    },
    importTasks: (tasks: Task[]) => {
      const imported = parseTaskBackup(createTaskBackup(tasks));
      return mutate((current) => appendTasks(current, imported));
    },
    retry: () => {
      return enqueue(async () => {
        await load();
        try {
          if (!database) await initializeDatabase();
          records = journal.length ? await commit() : await readRecords();
          journal = [];
          publish("saved");
          signal();
        } catch {
          publish(
            journal.length ? "unsaved" : "unavailable",
            journal.length ? SAVE_FAILURE : LOAD_FAILURE,
          );
        }
      });
    },
    dismissRecovery: () => {
      return enqueue(async () => {
        await load();
        try {
          if (!database) throw new Error("Storage unavailable");
          await new Promise<void>((resolve, reject) => {
            const tx = database!.transaction("meta", "readwrite");
            tx.objectStore("meta").put({ key: "legacy-imported", value: true });
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error);
          });
          snapshot = { ...snapshot, recovery: null };
          legacyWarning = null;
          publish(journal.length ? "unsaved" : "saved", journal.length ? SAVE_FAILURE : null);
          signal();
        } catch {
          publish(
            snapshot.status,
            "Previous saved data is still preserved. Allow browser storage and retry to keep the current tasks.",
          );
        }
      });
    },
    dispose,
  };
}
export type TaskRepository = ReturnType<typeof createTaskRepository>;
