import { useTeam } from "../../hooks/useTeam";
import { MemberList } from "../team/MemberList";
import { InviteForm } from "../team/InviteForm";
import { ErrorState } from "../common/ErrorState";
import { Skeleton } from "../common/LoadingSkeleton";

interface TeamTabProps {
  workspaceId: string;
  ownerId?: string;
  isOwner: boolean;
}

export function TeamTab({ workspaceId, ownerId, isOwner }: TeamTabProps) {
  const { data, loading, error, refetch, setData } = useTeam(workspaceId);

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 pt-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {loading && (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {error && !loading && <ErrorState message={error} onRetry={refetch} />}
        {!loading && !error && data && (
          <>
            {isOwner && (
              <InviteForm
                workspaceId={workspaceId}
                onInvited={(invite) =>
                  setData({
                    ...data,
                    invites: [invite, ...data.invites],
                  })
                }
              />
            )}
            <MemberList
              workspaceId={workspaceId}
              members={data.members}
              invites={data.invites}
              isOwner={isOwner}
              ownerId={ownerId}
              onInviteRevoked={(id) =>
                setData({
                  ...data,
                  invites: data.invites.filter((inv) => inv.id !== id),
                })
              }
              onMemberChanged={(userId, role) =>
                setData({
                  ...data,
                  members: data.members.map((m) =>
                    m.user_id === userId ? { ...m, role } : m
                  ),
                })
              }
              onMemberRemoved={(userId) =>
                setData({
                  ...data,
                  members: data.members.filter((m) => m.user_id !== userId),
                })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
