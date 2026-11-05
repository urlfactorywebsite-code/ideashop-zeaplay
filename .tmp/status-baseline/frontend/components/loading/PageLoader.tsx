import React from 'react';

const PageLoader: React.FC = () => (
  <div className="h-full min-h-[50vh] space-y-6 p-6">
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-3">
        <div className="h-4 w-32 animate-pulse rounded-full bg-white/10" />
        <div className="h-8 w-64 animate-pulse rounded-full bg-white/15" />
      </div>
      <div className="h-10 w-28 animate-pulse rounded-full bg-white/10" />
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/10" />
      ))}
    </div>
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse rounded-xl bg-white/10" />
      ))}
    </div>
  </div>
);

export default PageLoader;
