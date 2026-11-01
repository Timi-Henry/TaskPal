import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";

type Props = {
  text: string | null;
  onClose: () => void;
};

export default function TaskDetailsDialog({ text, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (text === null || !dialog) return;

    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      root.style.overflow = previousOverflow;
    };
  }, [text]);

  return (
    <dialog
      ref={dialogRef}
      className="task-detail-panel"
      aria-labelledby="task-detail-heading"
      onClose={() => {
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <header className="task-detail-header">
        <h2 id="task-detail-heading">Task details</h2>
        <button
          type="button"
          className="task-detail-close"
          aria-label="Close task details"
          onClick={() => dialogRef.current?.close()}
          autoFocus
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>
      <div className="task-detail-body" role="region" aria-label="Full task text" tabIndex={0}>
        <p>{text}</p>
      </div>
    </dialog>
  );
}
