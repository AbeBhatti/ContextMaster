import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "./components/layout/DashboardLayout";
import { HomePage } from "./pages/HomePage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { OAuthAuthorizePage } from "./pages/OAuthAuthorizePage";
import { SettingsPage } from "./pages/SettingsPage";
import { HelpPage } from "./pages/HelpPage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";

export function App() {
  return (
    <Routes>
      <Route element={<DashboardLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/workspace/:id" element={<WorkspacePage />} />
        <Route path="/workspace/:id/:tab" element={<WorkspacePage />} />
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route path="/organizations/:id" element={<OrganizationPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Route>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
