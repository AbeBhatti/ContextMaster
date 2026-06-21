interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-shimmer rounded-md ${className}`}
      style={{
        background:
          "linear-gradient(90deg, rgba(67,55,39,0.06) 0%, rgba(67,55,39,0.12) 50%, rgba(67,55,39,0.06) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

export function ChunkListSkeleton() {
  return (
    <div className="flex flex-col gap-2 px-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border-b border-[rgba(67,55,39,0.08)] py-3 flex items-center gap-3"
        >
          <Skeleton className="h-[22px] w-[22px] rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-3 w-6" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[rgba(67,55,39,0.12)] bg-cream-50 p-4 flex flex-col gap-2"
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
