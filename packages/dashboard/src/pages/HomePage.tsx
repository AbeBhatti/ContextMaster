import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDashboard } from "../components/layout/DashboardLayout";
import { EmptyState } from "../components/common/EmptyState";
import { ONBOARDING_KEY } from "./OnboardingPage";

export function HomePage() {
  const navigate = useNavigate();
  const { workspaces, user } = useDashboard();

  useEffect(() => {
    if (workspaces.length === 0) return;
    let onboardingDone = true;
    try {
      onboardingDone =
        window.localStorage.getItem(ONBOARDING_KEY(user?.id)) === "1";
    } catch {
      // localStorage unavailable — fall through to the workspace.
    }
    if (!onboardingDone) {
      navigate("/onboarding", { replace: true });
      return;
    }
    // Pin the default first; pick whichever workspace lives at index 0.
    navigate(`/workspace/${workspaces[0].id}`, { replace: true });
  }, [workspaces, navigate, user?.id]);

  if (workspaces.length === 0) {
    return (
      <EmptyState
        title="Setting things up…"
        body="Redirecting you to onboarding."
      />
    );
  }
  return null;
}
