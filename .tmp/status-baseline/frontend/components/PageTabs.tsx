import React, { useEffect, useRef } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

type Tab = { key: string; label: string; to: string; icon: React.ElementType };

/** Shared route-backed page tabs for Settings and Management. */
export default function PageTabs({ tabs, active, scope, label }: { tabs: Tab[]; active: string; scope: string; label: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const showSelected = () => {
      const tab = document.getElementById(`${scope}-tab-${active}`);
      if (!tab) return;
      const frame = container.getBoundingClientRect(), item = tab.getBoundingClientRect();
      if (item.left < frame.left) container.scrollLeft -= frame.left - item.left;
      else if (item.right > frame.right) container.scrollLeft += item.right - frame.right;
    };
    showSelected();
    const observer = new ResizeObserver(showSelected);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, scope, tabs.length]);
  return <nav ref={tabsRef} className="mt-6 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => {
      const Icon = tab.icon;
      return <NavLink key={tab.key} role="tab" id={`${scope}-tab-${tab.key}`}
        aria-selected={active === tab.key} aria-controls={`${scope}-panel-${tab.key}`}
        tabIndex={active === tab.key ? 0 : -1}
        to={{ pathname: tab.to, search: location.search }} state={location.state}
        onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : -1;
          if (next < 0) return;
          event.preventDefault();
          navigate({ pathname: tabs[next].to, search: location.search }, { state: location.state });
          document.getElementById(`${scope}-tab-${tabs[next].key}`)?.focus();
        }}
        className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none ${active === tab.key ? 'border-primary bg-primary text-white shadow-sm' : 'border-border-color text-text-secondary hover:border-primary/50 hover:bg-primary/10 hover:text-text-primary'}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />{tab.label}
      </NavLink>;
    })}
  </nav>;
}
