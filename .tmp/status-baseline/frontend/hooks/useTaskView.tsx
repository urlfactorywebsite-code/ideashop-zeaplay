import React, { createContext, useCallback, useContext, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { updateTaskFilter } from '../utils/taskNavigation';

export const TaskViewActive = createContext(true);
export const useTaskViewActive = () => useContext(TaskViewActive);

const Filters = createContext<{ search: string; set: (key: string, value: string) => void } | null>(null);

/** The URL owns common filters; view-specific controls retain separate keys/state. */
export function TaskFiltersProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const pendingSearch = useRef(location.search);
  pendingSearch.current = location.search;
  const set = useCallback((key: string, value: string) => {
    // Merge synchronous reset operations rather than overwriting earlier keys.
    pendingSearch.current = updateTaskFilter(pendingSearch.current, key, value);
    navigate({ pathname: location.pathname, search: pendingSearch.current }, { replace: true, state: location.state });
  }, [location.pathname, location.state, navigate]);
  return <Filters.Provider value={{ search: location.search, set }}>{children}</Filters.Provider>;
}

export function useTaskFilter<T extends string = string>(key: string, empty = '' as T): [T, (value: T) => void] {
  const filters = useContext(Filters);
  if (!filters) throw new Error('TaskFiltersProvider is required');
  const value = (new URLSearchParams(filters.search).get(key) || empty) as T;
  const set = useCallback((next: T) => filters.set(key, next), [filters.set, key]);
  return [value, set];
}
