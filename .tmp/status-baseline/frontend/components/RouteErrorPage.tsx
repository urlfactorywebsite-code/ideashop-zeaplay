import React from 'react';
import { useRouteError } from 'react-router-dom';

export const isModuleLoadError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : '';
    return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk .+ failed/i.test(message);
};

export const RouteErrorView: React.FC<{ error: unknown }> = ({ error }) => {
    const moduleFailed = isModuleLoadError(error);
    return (
        <main className="min-h-screen bg-background text-text-primary flex items-center justify-center p-6">
            <section role="alert" aria-labelledby="route-error-title" className="w-full max-w-lg rounded-2xl border border-border-color bg-surface p-8 shadow-lg">
                <h1 id="route-error-title" className="text-2xl font-semibold">
                    {moduleFailed ? 'This page couldn’t load' : 'Something went wrong'}
                </h1>
                <p className="mt-4 text-text-secondary">
                    {moduleFailed
                        ? 'The app may have been updated, or your connection was interrupted. Reload to get the latest version. If you’re offline, reconnect first.'
                        : 'Reload the page to try again. If the problem continues, contact your administrator.'}
                </p>
                <p className="mt-3 text-sm text-text-secondary">Unsaved changes on this page may be lost when you reload.</p>
                <div className="mt-6 flex flex-wrap items-center gap-4">
                    <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-primary px-5 py-2.5 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
                        Reload page
                    </button>
                    <a href="/" className="text-primary underline">Go to home</a>
                </div>
            </section>
        </main>
    );
};

// Keep this eagerly imported: recovery must work when a lazy page is unavailable.
const RouteErrorPage: React.FC = () => <RouteErrorView error={useRouteError()} />;

export default RouteErrorPage;
