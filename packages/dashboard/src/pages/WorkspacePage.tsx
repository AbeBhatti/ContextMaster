import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspace } from "../hooks/useWorkspace";
import { useDashboard } from "../components/layout/DashboardLayout";
import {
  WorkspaceHeader,
  type TabId,
} from "../components/layout/WorkspaceHeader";
import { KnowledgeGraph } from "../components/graph/KnowledgeGraph";
import { ListView } from "../components/workspace/ListView";
import { HistoryTab } from "../components/workspace/HistoryTab";
import { DocumentsTab } from "../components/workspace/DocumentsTab";
import { TeamTab } from "../components/workspace/TeamTab";
import { SettingsTab } from "../components/workspace/SettingsTab";
import { KBPanel } from "../components/kb/KBPanel";
import { CreateKbModal } from "../components/kb/CreateKbModal";
import {
  KBContextMenu,
  useKBContextMenu,
} from "../components/kb/KBContextMenu";
import { Skeleton } from "../components/common/LoadingSkeleton";
import { ErrorState } from "../components/common/ErrorState";
import { EmptyState } from "../components/common/EmptyState";
import { useProcessingKbs } from "../hooks/useProcessingKbs";
import { useFocusRefetch } from "../hooks/useFocusRefetch";
import { api } from "../lib/api";
import type { KnowledgeBase } from "../lib/types";

const VALID_TABS: TabId[] = [
  "graph",
  "list",
  "history",
  "documents",
  "team",
  "settings",
];

export function WorkspacePage() {
  const navigate = useNavigate();
  const params = useParams();
  const {
    workspaces,
    patchWorkspace,
    removeWorkspace,
    refetchWorkspaces,
  } = useDashboard();

  const id = params.id ?? "";
  const tabParam = (params.tab as TabId | undefined) ?? "graph";
  const tab: TabId = VALID_TABS.includes(tabParam) ? tabParam : "graph";

  const { data: workspace, loading, error, refetch, setData } = useWorkspace(id);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [creatingKb, setCreatingKb] = useState(false);
  const [autoRenameKb, setAutoRenameKb] = useState(false);
  const { state: ctxMenu, openMenu, closeMenu } = useKBContextMenu();

  // kb_id → 'queued' | 'processing'. Polls every 3s while any job is
  // in-flight, drops to a 60s freshness poll when idle. Drives the
  // ProcessingRing animation on graph nodes.
  const processingKbs = useProcessingKbs(id || null);

  // Wake every event-bus listener when the user switches back to the tab
  // or refocuses the window. Lives at the page root so we only attach
  // the listeners once, regardless of how many child hooks are mounted.
  useFocusRefetch(() => {
    refetch();
  });

  // reset slide-over when workspace or tab changes
  useEffect(() => {
    setSelectedKbId(null);
    setCreatingKb(false);
    setAutoRenameKb(false);
    closeMenu();
  }, [id, tab, closeMenu]);

  const handleKbCreated = (kb: KnowledgeBase) => {
    if (!workspace) return;
    setData({
      ...workspace,
      knowledge_bases: [kb, ...workspace.knowledge_bases],
    });
    setCreatingKb(false);
    setSelectedKbId(kb.id);
    refetchWorkspaces();
  };

  const handleContextMenuRename = () => {
    if (ctxMenu.kbId) {
      setAutoRenameKb(true);
      setSelectedKbId(ctxMenu.kbId);
    }
  };

  const handleMoveConfirm = async (targetWorkspaceId: string) => {
    if (!ctxMenu.kbId || !workspace) return;
    const kbId = ctxMenu.kbId;
    await api.knowledgeBases.move(kbId, targetWorkspaceId);
    setData({
      ...workspace,
      knowledge_bases: workspace.knowledge_bases.filter((kb) => kb.id !== kbId),
    });
    if (selectedKbId === kbId) setSelectedKbId(null);
    refetchWorkspaces();
  };

  const handleCopyConfirm = async (targetWorkspaceId: string) => {
    if (!ctxMenu.kbId || !workspace) return;
    await api.knowledgeBases.copy(ctxMenu.kbId, targetWorkspaceId);
    refetchWorkspaces();
  };

  const handleDeleteConfirm = async () => {
    if (!ctxMenu.kbId || !workspace) return;
    const kbId = ctxMenu.kbId;
    await api.knowledgeBases.delete(kbId);
    setData({
      ...workspace,
      knowledge_bases: workspace.knowledge_bases.filter((kb) => kb.id !== kbId),
    });
    if (selectedKbId === kbId) setSelectedKbId(null);
    refetchWorkspaces();
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-8">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="mt-4 flex-1">
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  if (!workspace) {
    return (
      <EmptyState
        title="Workspace not found"
        body="It might have been deleted or you no longer have access."
      />
    );
  }

  const selectedKb = workspace.knowledge_bases.find(
    (kb) => kb.id === selectedKbId
  );
  const isViewer = workspace.role === "viewer";

  return (
    <>
      <WorkspaceHeader
        workspace={workspace}
        activeTab={tab}
        onInvite={() => navigate(`/workspace/${workspace.id}/team`)}
        onCreateKb={!isViewer ? () => setCreatingKb(true) : undefined}
      />

      <div className="flex min-h-0 flex-1">
        {tab === "graph" && (
          <div className="relative flex w-full px-8 pb-8 pt-5">
            {workspace.knowledge_bases.length === 0 ? (
              <EmptyState
                title="No knowledge bases yet"
                body="Connect a tool via the Settings tab — your AI sessions will create knowledge bases automatically."
                action={
                  !isViewer ? (
                    <button
                      onClick={() => setCreatingKb(true)}
                      className="rounded-md bg-ink-800 px-3.5 py-1.5 text-[13px] font-medium text-cream-50"
                    >
                      New knowledge base
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <KnowledgeGraph
                knowledgeBases={workspace.knowledge_bases}
                selectedId={selectedKbId}
                onSelect={(kbId) => setSelectedKbId(kbId)}
                onCreateKb={!isViewer ? () => setCreatingKb(true) : undefined}
                onNodeContextMenu={
                  !isViewer
                    ? (e, kb) => openMenu(e, kb.id, kb.name, kb.chunk_count)
                    : undefined
                }
                processingKbStatus={processingKbs.byKb}
              />
            )}
          </div>
        )}

        {tab === "list" &&
          (workspace.knowledge_bases.length === 0 ? (
            <EmptyState
              title="No knowledge bases yet"
              body="Connect a tool via the Settings tab to start populating this workspace."
            />
          ) : (
            <ListView
              knowledgeBases={workspace.knowledge_bases}
              onSelect={(kbId) => setSelectedKbId(kbId)}
            />
          ))}

        {tab === "history" && (
          <HistoryTab
            workspaceId={workspace.id}
            knowledgeBases={workspace.knowledge_bases}
            members={workspace.members}
          />
        )}

        {tab === "documents" && (
          <DocumentsTab
            workspaceId={workspace.id}
            knowledgeBases={workspace.knowledge_bases}
            isViewer={isViewer}
          />
        )}

        {tab === "team" && !workspace.is_default && (
          <TeamTab
            workspaceId={workspace.id}
            ownerId={workspace.owner_id}
            isOwner={workspace.role === "owner"}
          />
        )}

        {tab === "team" && workspace.is_default && (
          <EmptyState
            title="Personal workspace"
            body="The default workspace is always private. Switch to a shared workspace to manage members."
          />
        )}

        {tab === "settings" && (
          <SettingsTab
            workspace={workspace}
            onWorkspaceUpdated={(patch) => {
              setData({ ...workspace, ...patch });
              if (patch.name !== undefined) {
                patchWorkspace(workspace.id, { name: patch.name });
              }
              if (patch.description !== undefined) {
                patchWorkspace(workspace.id, {
                  description: patch.description,
                });
              }
              if (patch.retrieval_scope !== undefined) {
                patchWorkspace(workspace.id, {
                  retrieval_scope: patch.retrieval_scope,
                });
              }
            }}
            onWorkspaceDeleted={() => {
              removeWorkspace(workspace.id);
              refetchWorkspaces();
            }}
          />
        )}
      </div>

      {selectedKb && (
        <KBPanel
          workspaceId={workspace.id}
          kb={selectedKb}
          allKbs={workspace.knowledge_bases}
          isViewer={isViewer}
          autoEditName={autoRenameKb}
          onClose={() => {
            setSelectedKbId(null);
            setAutoRenameKb(false);
          }}
          onKbUpdated={(patch) => {
            setAutoRenameKb(false);
            setData({
              ...workspace,
              knowledge_bases: workspace.knowledge_bases.map((kb) =>
                kb.id === patch.id ? { ...kb, ...patch } : kb
              ),
            });
          }}
        />
      )}

      {creatingKb && (
        <CreateKbModal
          workspaceId={workspace.id}
          onClose={() => setCreatingKb(false)}
          onCreated={handleKbCreated}
        />
      )}

      <KBContextMenu
        state={ctxMenu}
        onClose={closeMenu}
        onRename={handleContextMenuRename}
        onMoveConfirm={handleMoveConfirm}
        onCopyConfirm={handleCopyConfirm}
        onDeleteConfirm={handleDeleteConfirm}
        workspaces={workspaces}
        currentWorkspaceId={workspace.id}
      />
    </>
  );
}
