"use client";
import { useState } from "react";
export function CopyCommit({ sha }: { sha: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="build-commit">
      <code>{sha.slice(0, 12)}</code>
      <button
        className="button-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(sha);
            setStatus("Full commit copied");
          } catch {
            setStatus("Copy unavailable. Select the full commit below.");
          }
        }}
      >
        Copy full commit
      </button>
      <span role="status">{status}</span>
      <details>
        <summary>Show full commit</summary>
        <code>{sha}</code>
      </details>
    </div>
  );
}
