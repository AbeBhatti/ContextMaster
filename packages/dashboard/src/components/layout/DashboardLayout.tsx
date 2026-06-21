import { useCallback, useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useUser } from "../../hooks/useUser";
import { useWorkspaces } from "../../hooks/useWorkspaces";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Skeleton } from "../common/LoadingSkeleton";
import { ErrorState } from "../common/ErrorState";
import { identify, reset, trackPageView } from "../../lib/analytics";
import type { User, WorkspaceSummary } from "../../lib/types";

export interface DashboardContext {
  user: User | null;
  workspaces: WorkspaceSummary[];
  refetchWorkspaces: () => void;
  patchWorkspace: (
    id: string,
    patch: Partial<WorkspaceSummary>
  ) => void;
  removeWorkspace: (id: string) => void;
}

export function useDashboard(): DashboardContext {
  return useOutletContext<DashboardContext>();
}

export function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const userQ = useUser();
  const workspacesQ = useWorkspaces();

  const onWorkspace = location.pathname.startsWith("/workspace/");
  const activeId = onWorkspace ? params.id ?? null : null;

  // Auto-redirect to onboarding when the authenticated user has zero
  // workspaces. Existing users with workspaces stay where they are unless
  // they explicitly re-launch onboarding from the help page.
  useEffect(() => {
    if (workspacesQ.loading) return;
    if (!workspacesQ.data) return;
    if (workspacesQ.data.length === 0 && location.pathname !== "/onboarding") {
      navigate("/onboarding", { replace: true });
    }
  }, [workspacesQ.loading, workspacesQ.data, navigate, location.pathname]);

  const userId = userQ.data?.id ?? null;
  const userEmail = userQ.data?.email ?? null;
  const userName = userQ.data?.name ?? null;
  const userCreatedAt = userQ.data?.created_at ?? null;
  useEffect(() => {
    if (userId) {
      identify(userId, {
        email: userEmail,
        name: userName,
        createdAt: userCreatedAt,
      });
    } else {
      reset();
    }
  }, [userId, userEmail, userName, userCreatedAt]);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  const patchWorkspace = useCallback(
    (id: string, patch: Partial<WorkspaceSummary>) => {
      workspacesQ.setData(
        (workspacesQ.data ?? []).map((w) =>
          w.id === id ? { ...w, ...patch } : w
        )
      );
    },
    [workspacesQ]
  );

  const removeWorkspace = useCallback(
    (id: string) => {
      workspacesQ.setData(
        (workspacesQ.data ?? []).filter((w) => w.id !== id)
      );
    },
    [workspacesQ]
  );

  const ctx: DashboardContext = useMemo(
    () => ({
      user: userQ.data,
      workspaces: workspacesQ.data ?? [],
      refetchWorkspaces: workspacesQ.refetch,
      patchWorkspace,
      removeWorkspace,
    }),
    [userQ.data, workspacesQ.data, workspacesQ.refetch, patchWorkspace, removeWorkspace]
  );

  if (workspacesQ.loading) {
    return (
      <div className="flex h-screen w-screen">
        <div
          className="flex w-[240px] flex-shrink-0 flex-col gap-2 bg-cream-200 p-4"
          style={{ borderRight: "0.5px solid rgba(67,55,39,0.12)" }}
        >
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-10 w-1/3" />
        </div>
      </div>
    );
  }

  if (workspacesQ.error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <ErrorState
          message={workspacesQ.error}
          onRetry={workspacesQ.refetch}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen">
      <Sidebar
        workspaces={workspacesQ.data ?? []}
        activeId={activeId}
        user={userQ.data}
        onWorkspaceCreated={(ws) => {
          workspacesQ.setData([ws, ...(workspacesQ.data ?? [])]);
        }}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <TopBar />
        <Outlet context={ctx} />
      </main>
    </div>
  );
}
