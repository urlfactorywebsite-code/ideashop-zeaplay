
import React, { Suspense } from 'react';
import { createHashRouter, RouterProvider, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth, SearchProvider, ThemeProvider, useTheme } from './hooks/useAuth';
import { LoadingProvider } from './components/loading/LoadingProvider';
import PageLoader from './components/loading/PageLoader';
import ProtectedRoute from './components/ProtectedRoute';
import SettingsRedirect from './components/SettingsRedirect';
import { LEGACY_SETTINGS_ROUTES } from './utils/settingsNavigation';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import { Role } from './types';
import { NavigationProvider } from './hooks/useNavigation';
import NavigationGuard, { NavigationUnavailable } from './components/NavigationGuard';
import RouteErrorPage from './components/RouteErrorPage';

const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Tasks = React.lazy(() => import('./pages/AllTasks'));
const Management = React.lazy(() => import('./pages/Management'));
const Projects = React.lazy(() => import('./pages/Projects'));
const Reports = React.lazy(() => import('./pages/Reports'));
const Settings = React.lazy(() => import('./pages/Settings'));
const Achievements = React.lazy(() => import('./pages/Achievements'));
const OAuthAuthorization = React.lazy(() => import('./pages/OAuthAuthorization'));
const Tickets = React.lazy(() => import('./pages/TicketPage'));
const Chat = React.lazy(() => import('./pages/Chat'));
const ToolLibrary = React.lazy(() => import('./pages/ToolLibrary'));
const Layout = React.lazy(() => import('./components/Layout'));
const PasswordReset = React.lazy(() => import('./pages/PasswordReset'));

const ProtectedLayout: React.FC = () => {
    return (
        <ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}>
            <Suspense fallback={<PageLoader />}>
              <Layout>
                <Suspense fallback={<PageLoader />}>
                    <NavigationGuard><Outlet /></NavigationGuard>
                </Suspense>
              </Layout>
            </Suspense>
        </ProtectedRoute>
    );
};

const AppRoutes: React.FC = () => {
    const { user } = useAuth();

    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<Suspense fallback={<PageLoader />}><PasswordReset /></Suspense>} />
            <Route path="/oauth/authorize" element={<Suspense fallback={<PageLoader />}><OAuthAuthorization /></Suspense>} />
            
            <Route path="/" element={<ProtectedLayout />}>
                <Route index element={<Navigate to={user?.role === Role.USER ? "/dashboard" : "/tasks"} replace />} />
                <Route path="navigation-unavailable" element={<NavigationUnavailable />} />
                
                <Route path="dashboard" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Dashboard /></ProtectedRoute>} />
                <Route path="tasks/*" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Tasks /></ProtectedRoute>} />
                <Route path="clients" element={<SettingsRedirect to="/management/clients" />} />
                <Route path="management/*" element={<ProtectedRoute roles={[Role.MANAGER, Role.ADMIN, Role.OWNER]}><Management /></ProtectedRoute>} />
                <Route path="projects" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Projects /></ProtectedRoute>} />
                <Route path="admin/users" element={<SettingsRedirect to="/management/users" />} />
                <Route path="admin/rewards" element={<ProtectedRoute roles={[Role.MANAGER, Role.ADMIN, Role.OWNER]}><Navigate to="/achievements?tab=rewards" replace /></ProtectedRoute>} />
                <Route path="admin/points-table" element={<ProtectedRoute roles={[Role.OWNER]}><Navigate to="/achievements?tab=points" replace /></ProtectedRoute>} />
                <Route path="kanban" element={<SettingsRedirect to="/tasks/kanban" />} />
                <Route path="calendar" element={<SettingsRedirect to="/tasks/calendar" />} />
                <Route path="gantt" element={<SettingsRedirect to="/tasks/gantt" />} />
                <Route path="reports" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Reports /></ProtectedRoute>} />
                <Route path="tool-library" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><ToolLibrary /></ProtectedRoute>} />
                {Object.entries(LEGACY_SETTINGS_ROUTES).map(([from, to]) => <Route key={from} path={from.slice(1)} element={<SettingsRedirect to={to} />} />)}
                <Route path="settings/*" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Settings /></ProtectedRoute>} />
                <Route path="achievements" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Achievements /></ProtectedRoute>} />
                <Route path="levels" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Navigate to="/achievements?tab=levels" replace /></ProtectedRoute>} />
                <Route path="tickets" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Tickets /></ProtectedRoute>} />
                <Route path="chat" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Chat /></ProtectedRoute>} />
                <Route path="chat/:conversationId" element={<ProtectedRoute roles={[Role.USER, Role.MANAGER, Role.ADMIN, Role.OWNER]}><Chat /></ProtectedRoute>} />
                <Route path="template-editor" element={<ProtectedRoute roles={[Role.OWNER]}><Navigate to="/achievements?tab=templates" replace /></ProtectedRoute>} />


            </Route>
            
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
};

const AppContent: React.FC = () => {
  const { theme } = useTheme();
  const backgroundImage = theme === 'colorful' ? `url('https://res.cloudinary.com/dqhcbck76/image/upload/v1770622362/4882066_gjwlts.jpg')` : 'none';
  return (
    <div style={{ backgroundImage, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat', minHeight: '100vh' }}>
      <AppRoutes />
    </div>
  );
};

const AppProviders: React.FC = () => {
  return (
      <ThemeProvider>
        <LoadingProvider>
          <AuthProvider>
            <SearchProvider>
              <NavigationProvider>
              <AppContent />
              </NavigationProvider>
            </SearchProvider>
          </AuthProvider>
        </LoadingProvider>
      </ThemeProvider>
  );
};

// A data router retains the existing hash URLs and supports reliable form blockers.
const router = createHashRouter([{ path: '*', element: <AppProviders />, errorElement: <RouteErrorPage /> }]);
const App: React.FC = () => <RouterProvider router={router} />;

export default App;

