import { IDBFactory } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import App from "./App";

vi.mock("./components/ShaderBackground", () => ({ default: () => null }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function start() {
  const view = render(<App />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
  return view;
}

async function add(title: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: title } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByText(title.trim(), { selector: ".task-title" });
}

describe("TaskPal task interactions", () => {
  it("starts empty, rejects whitespace and focuses the invalid field", async () => {
    await start();
    expect(document.querySelectorAll(".task-card")).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please enter a task title.");
    expect(screen.getByRole("textbox", { name: "New task" })).toHaveFocus();
  });

  it("trims a title, toggles completion and updates the accessible progress value", async () => {
    await start();
    await add("  Finish the assessment  ");
    const toggle = screen.getByRole("button", { name: "Mark Finish the assessment complete" });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("opens the complete unlimited title in the detail dialog", async () => {
    await start();
    const title = "Long Unicode 🌱 task ".repeat(200).trim();
    await add(title);
    fireEvent.click(screen.getByRole("button", { name: /^Open full task:/ }));
    const dialog = await screen.findByRole("dialog", { name: "Task details" });
    expect(dialog).toHaveTextContent(title);
    expect(dialog.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("supports keyboard deletion and restores the deleted task with Undo", async () => {
    const user = userEvent.setup();
    await start();
    await add("Keep this task");
    const remove = screen.getByRole("button", { name: "Delete Keep this task" });
    remove.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(document.querySelectorAll(".task-card")).toHaveLength(0));
    expect(screen.getByRole("textbox", { name: "New task" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Undo delete" }));
    expect(
      await screen.findByText("Keep this task", { selector: ".task-title" }),
    ).toBeInTheDocument();
  });

  it("reloads persisted tasks and completion through a fresh hook instance", async () => {
    const first = await start();
    await add("Saved task");
    fireEvent.click(screen.getByRole("button", { name: "Mark Saved task complete" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mark Saved task incomplete" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    first.unmount();
    await start();
    expect(await screen.findByText("Saved task", { selector: ".task-title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Saved task incomplete" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("shows one storage warning outside task rows even when empty or populated", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await start();
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
    await add("Unsaved task A");
    await add("Unsaved task B");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(document.querySelectorAll(".task-card [role=alert]")).toHaveLength(0);
    expect(screen.getByText("Unsaved task A", { selector: ".task-title" })).toBeInTheDocument();
  });
});
