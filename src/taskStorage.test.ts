import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  createTaskBackup,
  createTaskRepository,
  LEGACY_STORAGE_KEY,
  parseTaskBackup,
  type Task,
} from "./taskStorage";

const repositories: ReturnType<typeof createTaskRepository>[] = [];
const task = (id: string, title = `Task ${id}`): Task => ({ id, title, completed: false });

function repository(options: Parameters<typeof createTaskRepository>[0] = {}) {
  const value = createTaskRepository({
    databaseName: crypto.randomUUID(),
    indexedDB: new IDBFactory(),
    storage: null,
    channelFactory: () => null,
    ...options,
  });
  repositories.push(value);
  return value;
}

afterEach(() => {
  for (const value of repositories.splice(0)) value.dispose();
});

describe("task storage", () => {
  it("starts empty and saves a long Unicode title across repository instances", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const first = repository({ indexedDB, databaseName });
    await first.load();
    expect(first.getSnapshot().tasks).toEqual([]);
    const value = task("long", "Unicode 🌱 " + "Long title ".repeat(1000));
    await first.add(value);
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks).toEqual([value]);
  });

  it("merges two stale tabs without replacing the other tab's tasks", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const a = repository({ indexedDB, databaseName });
    const b = repository({ indexedDB, databaseName });
    await Promise.all([a.load(), b.load()]);
    await a.add(task("a"));
    await b.add(task("b"));
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks.map((value) => value.id)).toEqual(["a", "b"]);
  });

  it("commits simultaneous additions from separate repositories", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const a = repository({ indexedDB, databaseName });
    const b = repository({ indexedDB, databaseName });
    await Promise.all([a.load(), b.load()]);
    await Promise.all([a.add(task("a")), b.add(task("b"))]);
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(
      reopened
        .getSnapshot()
        .tasks.map((value) => value.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("does not resurrect a task when a stale tab toggles it after deletion", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const a = repository({ indexedDB, databaseName });
    await a.load();
    await a.add(task("a"));
    const b = repository({ indexedDB, databaseName });
    await b.load();
    await a.delete("a");
    await b.toggle("a");
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks).toEqual([]);
  });

  it("persists completion, deletion and undo at the original position", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const first = repository({ indexedDB, databaseName });
    await first.load();
    await first.add(task("a"));
    await first.add(task("b"));
    await first.toggle("a");
    const completed = first.getSnapshot().tasks[0];
    await first.delete("a");
    expect(first.getSnapshot().tasks.map((value) => value.id)).toEqual(["b"]);
    await first.restore(completed, 0);
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks).toEqual([completed, task("b")]);
  });

  it("restores a deleted task before its surviving neighbor after concurrent deletions", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const a = repository({ indexedDB, databaseName });
    await a.load();
    for (const id of ["a", "b", "c"]) await a.add(task(id));
    const b = repository({ indexedDB, databaseName });
    await b.load();
    await Promise.all([a.delete("a"), b.delete("b")]);
    await b.restore(task("b"), 1, { previousId: "a", nextId: "c" });
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks.map((value) => value.id)).toEqual(["b", "c"]);
  });

  it("migrates old browser tasks without needing to overwrite the original bytes", async () => {
    const raw = JSON.stringify({ version: 1, tasks: [task("legacy")] });
    const requested: string[] = [];
    const value = repository({
      storage: {
        getItem(key: string) {
          requested.push(key);
          return key === LEGACY_STORAGE_KEY ? raw : null;
        },
      },
    });
    await value.load();
    expect(requested).toContain(LEGACY_STORAGE_KEY);
    expect(value.getSnapshot().tasks).toEqual([task("legacy")]);
  });

  it("exposes unreadable legacy bytes for recovery", async () => {
    const raw = "{ damaged task backup";
    const value = repository({ storage: { getItem: () => raw } });
    await value.load();
    expect(value.getSnapshot().recovery?.raw).toBe(raw);
    expect(value.getSnapshot().storageMessage).toBeTruthy();
    await value.add(task("new"));
    expect(value.getSnapshot().tasks).toContainEqual(task("new"));
    expect(value.getSnapshot().recovery?.raw).toBe(raw);
  });

  it("keeps tasks usable and reports a failure when durable storage is unavailable", async () => {
    const value = repository({ indexedDB: null });
    await value.load();
    expect(value.getSnapshot().storageMessage).toBeTruthy();
    await value.add(task("unsaved"));
    expect(value.getSnapshot().tasks).toEqual([task("unsaved")]);
    expect(value.getSnapshot().status).not.toBe("saved");
  });

  it("retries unsaved operations after browser storage becomes available", async () => {
    const indexedDB = new IDBFactory();
    const databaseName = crypto.randomUUID();
    const open = indexedDB.open.bind(indexedDB);
    let available = false;
    Object.defineProperty(indexedDB, "open", {
      value(name: string, version?: number) {
        if (!available) throw new DOMException("Storage blocked", "SecurityError");
        return open(name, version);
      },
    });
    const value = repository({ indexedDB, databaseName });
    await value.load();
    await value.add(task("unsaved"));
    expect(value.getSnapshot().status).toBe("unsaved");
    available = true;
    await value.retry();
    expect(value.getSnapshot().status).toBe("saved");
    const reopened = repository({ indexedDB, databaseName });
    await reopened.load();
    expect(reopened.getSnapshot().tasks).toEqual([task("unsaved")]);
  });

  it("imports a backup without discarding existing tasks", async () => {
    const value = repository();
    await value.load();
    await value.add(task("old"));
    await value.importTasks([task("imported")]);
    expect(value.getSnapshot().tasks).toEqual([task("old"), task("imported")]);
  });
});

describe("task backup validation", () => {
  it("round trips task text and completion without interpreting markup", () => {
    const values = [{ ...task("html", "<img src=x onerror=alert(1)>"), completed: true }];
    expect(parseTaskBackup(createTaskBackup(values))).toEqual(values);
  });

  it("rejects malformed, duplicate and unsupported records", () => {
    expect(() => parseTaskBackup("invalid JSON")).toThrow();
    expect(() =>
      parseTaskBackup(JSON.stringify({ version: 1, tasks: [task("a"), task("a")] })),
    ).toThrow();
    expect(() =>
      parseTaskBackup(JSON.stringify({ version: 1, tasks: [task("a", "   ")] })),
    ).toThrow();
    expect(() => parseTaskBackup(JSON.stringify({ version: 999, tasks: [] }))).toThrow();
  });
});
