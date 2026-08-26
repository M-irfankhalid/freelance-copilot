import { Suspense, lazy } from "react";
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router";

import { AppLayout } from "@/components/layout/app-layout";
import { DashboardErrorBoundary } from "@/pages/dashboard/error";
import { DashboardLoading } from "@/pages/dashboard/loading";
import AnalyticsPage from "@/pages/analytics/page";
import AutomationPage from "@/pages/automation/page";
import BidsPage from "@/pages/bids/page";
import JobsPage from "@/pages/jobs/page";
import MatchesPage from "@/pages/matches/page";
import PlatformsPage from "@/pages/platforms/page";
import ProposalsPage from "@/pages/proposals/page";
import ProfilePage from "@/pages/profile/page";
import SettingsPage from "@/pages/settings/page";
import NotFoundPage from "@/pages/not-found";

/** Code-split like the framework routers do, so the skeleton can show. */
const DashboardPage = lazy(() => import("@/pages/dashboard/page"));

/**
 * Route tree mirrors the Next.js `(app)` route group: every section renders
 * inside the sidebar + header shell.
 */
const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
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
      { path: "matches", element: <MatchesPage /> },
      { path: "proposals", element: <ProposalsPage /> },
      { path: "bids", element: <BidsPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "platforms", element: <PlatformsPage /> },
      { path: "automation", element: <AutomationPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
