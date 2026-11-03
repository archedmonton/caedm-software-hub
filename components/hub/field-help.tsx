"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Info } from "lucide-react";

export function FieldHelp({
  id,
  title,
  text,
}: {
  id: string;
  title: string;
  text: string;
}) {
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const hide = (event: Event) => {
      if (!content.current?.contains(event.target as Node))
        content.current?.hidePopover();
    };
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);
  return (
    <div
      className="field-help"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") content.current?.showPopover();
      }}
      onPointerLeave={() => {
        if (document.activeElement !== trigger.current)
          content.current?.hidePopover();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="field-help-trigger"
        aria-label={`About ${title}`}
        aria-describedby={id}
        aria-controls={id}
        aria-expanded={open}
        popoverTarget={id}
        onBlur={() => content.current?.hidePopover()}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            content.current?.hidePopover();
          }
        }}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      <div
        ref={content}
        id={id}
        popover="auto"
        role="tooltip"
        className="field-help-content"
        style={position}
        onToggle={() => {
          const visible = content.current?.matches(":popover-open") ?? false;
          setOpen(visible);
          if (visible && trigger.current && content.current) {
            const bounds = trigger.current.getBoundingClientRect();
            const width = Math.min(320, window.innerWidth - 32);
            const height = content.current.getBoundingClientRect().height;
            setPosition({
              left: Math.max(
                16,
                Math.min(bounds.left, window.innerWidth - width - 16),
              ),
              top:
                bounds.bottom + 8 + height <= window.innerHeight - 16
                  ? bounds.bottom + 8
                  : Math.max(16, bounds.top - height - 8),
            });
          }
        }}
      >
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}
