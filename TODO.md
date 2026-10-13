# Task Loading Performance Optimization

## Current Status
- [x] Analyzed root cause: Aggressive summary prefetching for all visible tasks
- [x] User approved plan ✅

## Implementation Plan (3 steps)

**1. Add prefetch control** `frontend/hooks/useTaskPrefetch.ts`
- [ ] Add `prefetchSummaries?: boolean` param  
- [ ] Guard summary `forEach` loop

**2. Tasks.tsx controls** `frontend/pages/Tasks.tsx`  
- [ ] Add `prefetchSummaries` state + "⚡ Fast Mode" toggle
- [ ] Reduce prefetchPages: `[currentPage + 1]` only
- [ ] Add pageSize selector: 10/20/50 options

**3. KanbanBoard pageSize** `frontend/pages/KanbanBoard.tsx`
- [ ] Add pageSize selector matching Tasks.tsx

**4. Testing**
- [ ] Run `npm run dev` 
- [ ] Verify reduced API calls via Network tab
- [ ] Test Fast Mode toggle

**Expected Results:**
- 60-80% fewer /summary calls  
- Instant page loads
- Manual performance control
