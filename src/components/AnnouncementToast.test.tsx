import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import AnnouncementToast from "./AnnouncementToast";

afterEach(() => {
  vi.useRealTimers();
});

describe("announcement toasts", () => {
  it("shows an accessible visible message and dismisses it after five seconds", async () => {
    vi.useFakeTimers();
    render(<AnnouncementToast announcement={{ id: 1, message: "Task added." }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Task added.");
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Task added.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();
  });

  it("restarts the timer for repeated announcements and supports manual dismissal", async () => {
    vi.useFakeTimers();
    const view = render(<AnnouncementToast announcement={{ id: 1, message: "Task added." }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    view.rerender(<AnnouncementToast announcement={{ id: 2, message: "Task added." }} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Task added.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.getByRole("status").textContent).toBe("");
    view.rerender(<AnnouncementToast announcement={{ id: 3, message: "Task restored." }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Task restored.");
  });
});
