import { useDocuments } from "../../hooks/useDocuments";
import { DocumentUpload } from "../documents/DocumentUpload";
import { DocumentList } from "../documents/DocumentList";
import type { KnowledgeBase } from "../../lib/types";
import { ErrorState } from "../common/ErrorState";
import { Skeleton } from "../common/LoadingSkeleton";
import { EmptyState } from "../common/EmptyState";

interface DocumentsTabProps {
  workspaceId: string;
  knowledgeBases: KnowledgeBase[];
  isViewer?: boolean;
}

export function DocumentsTab({
  workspaceId,
  knowledgeBases,
  isViewer = false,
}: DocumentsTabProps) {
  const { data, loading, error, refetch, setData } = useDocuments(workspaceId);

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {knowledgeBases.length === 0 ? (
          <EmptyState
            title="Create a knowledge base first"
            body="Documents are scoped to a knowledge base. Create one in the Graph tab to start uploading."
          />
        ) : (
          !isViewer && (
            <DocumentUpload
              workspaceId={workspaceId}
              knowledgeBases={knowledgeBases}
              onUploaded={(doc) => {
                if (data) setData([doc, ...data]);
                else refetch();
              }}
            />
          )
        )}

        {loading && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {error && !loading && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && (
          <DocumentList
            documents={data ?? []}
            showKb={true}
            isViewer={isViewer}
            onDeleted={(id) =>
              setData((data ?? []).filter((d) => d.id !== id))
            }
          />
        )}
      </div>
    </div>
  );
}
