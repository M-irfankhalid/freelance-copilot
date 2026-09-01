import { Suspense, lazy } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router";

import { AppLayout } from "@/components/layout/app-layout";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/shared/protected-route";
import { DashboardErrorBoundary } from "@/pages/dashboard/error";
import { DashboardLoading } from "@/pages/dashboard/loading";
import { PlatformsErrorBoundary } from "@/pages/platforms/error";
import { RouteErrorBoundary } from "@/components/shared/error-boundary";
import AnalyticsPage from "@/pages/analytics/page";
import AutomationPage from "@/pages/automation/page";
import BidsPage from "@/pages/bids/page";
import JobsPage from "@/pages/jobs/page";
import JobDetailPage from "@/pages/jobs/[id]/page";
import LoginPage from "@/pages/auth/login/page";
import LogsPage from "@/pages/logs/page";
import MatchesPage from "@/pages/matches/page";
import PlatformsPage from "@/pages/platforms/page";
import ProposalsPage from "@/pages/proposals/page";
import ProfilePage from "@/pages/profile/page";
import SettingsPage from "@/pages/settings/page";
import SignupPage from "@/pages/auth/signup/page";
import NotFoundPage from "@/pages/not-found";

/** Code-split like the framework routers do, so the skeleton can show. */
const DashboardPage = lazy(() => import("@/pages/dashboard/page"));

/**
 * Route tree. Auth and onboarding screens render standalone; everything else
 * lives inside the sidebar + header shell.
 */
const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: "/signup", element: <SignupPage />, errorElement: <RouteErrorBoundary /> },
  // { path: "/onboarding", element: <OnboardingPage />, errorElement: <RouteErrorBoundary /> },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <AppLayout />
      </ProtectedRoute>
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        path: "dashboard",
        element: (
          <DashboardErrorBoundary>
            <Suspense fallback={<DashboardLoading />}>
              <DashboardPage />
            </Suspense>
          </DashboardErrorBoundary>
        ),
      },
      { path: "jobs", element: <JobsPage /> },
      { path: "jobs/:id", element: <JobDetailPage /> },
      { path: "matches", element: <MatchesPage /> },
      { path: "proposals", element: <ProposalsPage /> },
      { path: "bids", element: <BidsPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "logs", element: <LogsPage /> },
      {
        path: "platforms",
        element: (
          <PlatformsErrorBoundary>
            <PlatformsPage />
          </PlatformsErrorBoundary>
        ),
      },
      { path: "automation", element: <AutomationPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
