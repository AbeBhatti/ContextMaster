import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-cream-300 text-ink-400 text-2xl">
          {icon ?? "◐"}
        </div>
        <div className="text-base font-semibold text-ink-800">{title}</div>
        {body && (
          <div className="mt-1.5 text-[13px] leading-relaxed text-ink-600">
            {body}
          </div>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
