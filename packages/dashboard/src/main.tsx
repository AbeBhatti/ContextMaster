import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";
import { App } from "./App";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { LandingPage } from "./pages/LandingPage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { setTokenGetter } from "./lib/auth";
import { AUTH_BYPASS_ENABLED, CLERK_PUBLISHABLE_KEY } from "./lib/constants";
import "./styles/globals.css";

function ClerkTokenBridge() {
  const { getToken } = useAuth();
  setTokenGetter(async () => {
    const token = await getToken();
    return token ?? null;
  });
  return null;
}

function AppOrLanding() {
  return (
    <>
      <SignedIn>
        <App />
      </SignedIn>
      <SignedOut>
        <LandingPage />
      </SignedOut>
    </>
  );
}

function Root() {
  if (AUTH_BYPASS_ENABLED) {
    return (
      <BrowserRouter>
        <App />
      </BrowserRouter>
    );
  }
  if (!CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-8 text-center">
        <div className="max-w-md text-ink-700">
          <div className="text-lg font-semibold mb-2 text-ink-900">
            Clerk not configured
          </div>
          <p className="text-[13px] leading-relaxed">
            Set <code className="bg-cream-200 px-1 rounded">VITE_CLERK_PUBLISHABLE_KEY</code> in
            <code className="bg-cream-200 px-1 rounded ml-1">.env</code>, or
            set <code className="bg-cream-200 px-1 rounded">VITE_AUTH_BYPASS=true</code> for dev mode.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <ClerkTokenBridge />
      <BrowserRouter>
        <Routes>
          {/* Invite routes work both signed-in and signed-out so users can
              create an account from the invite link. */}
          <Route path="/invite/:token" element={<AcceptInvitePage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="*" element={<AppOrLanding />} />
        </Routes>
      </BrowserRouter>
    </ClerkProvider>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element missing");
createRoot(rootElement).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
