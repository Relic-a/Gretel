import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  children: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ title, children, actionLabel, onAction }: EmptyStateProps) {
  return <div className="empty-state-layout">
    <h2>{title}</h2>
    <p>{children}</p>
    {actionLabel && onAction && <button type="button" className="action-button" onClick={onAction}>{actionLabel}</button>}
  </div>;
}
