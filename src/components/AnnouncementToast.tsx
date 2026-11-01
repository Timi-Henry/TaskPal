import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

type Props = {
  announcement: { id: number; message: string };
};

export default function AnnouncementToast({ announcement }: Props) {
  const [dismissedId, setDismissedId] = useState(0);
  const visible = announcement.id > dismissedId && announcement.message !== "";

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setDismissedId(announcement.id), 5000);
    return () => clearTimeout(timer);
  }, [announcement.id, visible]);

  return (
    <div className="task-toast-region">
      <div className={visible ? "task-toast" : "task-toast-empty"}>
        {visible && <Check className="task-toast-icon" size={20} aria-hidden="true" />}
        <p role="status" aria-live="polite" aria-atomic="true">
          <span key={announcement.id}>{visible ? announcement.message : ""}</span>
        </p>
        {visible && (
          <button
            type="button"
            className="task-toast-dismiss"
            aria-label="Dismiss notification"
            onClick={() => setDismissedId(announcement.id)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
