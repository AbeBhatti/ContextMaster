import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex items-center justify-center py-10 px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-cream-100 text-ink-400">
          <AlertCircle size={20} />
        </div>
        <div className="text-[15px] font-semibold text-ink-800">
          Something went wrong
        </div>
        <div className="mt-1 text-[13px] text-ink-600 leading-snug">{message}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-4 rounded-lg border border-[rgba(24,24,27,0.18)] bg-cream-50 px-3 py-1.5 text-[12.5px] font-medium text-ink-800 hover:bg-cream-100"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
