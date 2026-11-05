
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconOutline } from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';

import api from '../services/mockApi';
import {
  Role,
  Tool,
  ToolCategory,
  ToolCategoryStatus,
  ToolPricingType,
  ToolStatus,
} from '../types';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import PageLoader from '../components/loading/PageLoader';

type AdminTab = 'library' | 'categories' | 'approvals';

type ToolFormState = {
  name: string;
  description: string;
  website_url: string;
  preview_image_url: string;
  category_id: string;
  tags: string;
  pricing_type: ToolPricingType;
  is_internal: boolean;
};

type DecisionState = {
  tool: Tool;
  action: 'approve' | 'reject';
} | null;

const emptyForm: ToolFormState = {
  name: '',
  description: '',
  website_url: '',
  preview_image_url: '',
  category_id: '',
  tags: '',
  pricing_type: ToolPricingType.FREE,
  is_internal: false,
};

const ToolLibrary: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === Role.ADMIN || user?.role === Role.OWNER;
  const { notify } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>('library');
  const [search, setSearch] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [filterPricing, setFilterPricing] = useState<ToolPricingType | ''>('');

  const [categories, setCategories] = useState<ToolCategory[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<ToolCategory[]>([]);
  const [categoryPage, setCategoryPage] = useState(1);
  const [categoryTotalPages, setCategoryTotalPages] = useState(1);
  const [toolsByCategory, setToolsByCategory] = useState<Record<string, Tool[]>>({});
  const [libraryLoading, setLibraryLoading] = useState(false);

  const [filteredTools, setFilteredTools] = useState<Tool[]>([]);
  const [filteredPage, setFilteredPage] = useState(1);
  const [filteredTotalPages, setFilteredTotalPages] = useState(1);
  const [filteredLoading, setFilteredLoading] = useState(false);

  const [adminCategories, setAdminCategories] = useState<ToolCategory[]>([]);
  const [adminCategoriesLoading, setAdminCategoriesLoading] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: '',
    description: '',
    display_order: 0,
    status: ToolCategoryStatus.ACTIVE,
  });
  const [newCategoryError, setNewCategoryError] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<Tool[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);

  const [isAddToolOpen, setIsAddToolOpen] = useState(false);
  const [formState, setFormState] = useState<ToolFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [decisionState, setDecisionState] = useState<DecisionState>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const isFiltering = Boolean(
    search.trim() || filterCategoryId || filterTag || filterPricing
  );

  const availableTags = useMemo(() => {
    const sourceTools = isFiltering
      ? filteredTools
      : Object.values(toolsByCategory).flat();
    const tags = new Set<string>();
    sourceTools.forEach((tool) => {
      tool.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [filteredTools, isFiltering, toolsByCategory]);

  const loadCategoryOptions = useCallback(async () => {
    const response = await api.listToolLibraryCategories({
      page: 1,
      pageSize: 100,
      status: ToolCategoryStatus.ACTIVE,
    });
    setCategoryOptions(response.items);
  }, []);

  const loadCategories = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const response = await api.listToolLibraryCategories({
        page: categoryPage,
        pageSize: 10,
        status: ToolCategoryStatus.ACTIVE,
      });
      setCategories(response.items);
      setCategoryTotalPages(response.total_pages);

      const toolResponses = await Promise.all(
        response.items.map((category) =>
          api.listToolLibraryTools({
            categoryId: category.id,
            pageSize: 10,
            status: ToolStatus.APPROVED,
          })
        )
      );
      const nextTools: Record<string, Tool[]> = {};
      response.items.forEach((category, index) => {
        nextTools[category.id] = toolResponses[index]?.items ?? [];
      });
      setToolsByCategory(nextTools);
    } finally {
      setLibraryLoading(false);
    }
  }, [categoryPage]);

  const loadFilteredTools = useCallback(async () => {
    setFilteredLoading(true);
    try {
      const response = await api.listToolLibraryTools({
        page: filteredPage,
        pageSize: 18,
        q: search.trim() || undefined,
        categoryId: filterCategoryId || undefined,
        pricingType: filterPricing || undefined,
        tags: filterTag ? [filterTag] : undefined,
      });
      setFilteredTools(response.items);
      setFilteredTotalPages(response.total_pages);
    } finally {
      setFilteredLoading(false);
    }
  }, [filteredPage, search, filterCategoryId, filterPricing, filterTag]);

  const loadAdminCategories = useCallback(async () => {
    if (!isAdmin) return;
    setAdminCategoriesLoading(true);
    try {
      const response = await api.listToolLibraryCategories({ page: 1, pageSize: 100 });
      setAdminCategories(response.items);
    } finally {
      setAdminCategoriesLoading(false);
    }
  }, [isAdmin]);

  const loadPendingTools = useCallback(async () => {
    if (!isAdmin) return;
    setPendingLoading(true);
    try {
      const response = await api.listToolLibraryTools({
        page: 1,
        pageSize: 50,
        status: ToolStatus.PENDING,
      });
      setPendingTools(response.items);
    } finally {
      setPendingLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (activeTab !== 'library' || isFiltering) return;
    void loadCategories();
  }, [activeTab, isFiltering, loadCategories]);

  useEffect(() => {
    if (activeTab !== 'library' || !isFiltering) return;
    void loadFilteredTools();
  }, [activeTab, isFiltering, loadFilteredTools]);

  useEffect(() => {
    if (activeTab !== 'categories') return;
    void loadAdminCategories();
  }, [activeTab, loadAdminCategories]);

  useEffect(() => {
    if (activeTab !== 'approvals') return;
    void loadPendingTools();
  }, [activeTab, loadPendingTools]);

  useEffect(() => {
    setFilteredPage(1);
  }, [search, filterCategoryId, filterTag, filterPricing]);

  useEffect(() => {
    void loadCategoryOptions();
  }, [loadCategoryOptions]);

  const handleToggleFavorite = async (toolId: string) => {
    const updated = await api.toggleToolLibraryFavorite(toolId);
    setFilteredTools((prev) =>
      prev.map((tool) => (tool.id === toolId ? updated : tool))
    );
    setToolsByCategory((prev) => {
      const next: Record<string, Tool[]> = {};
      Object.entries(prev).forEach(([categoryId, tools]) => {
        next[categoryId] = tools.map((tool) => (tool.id === toolId ? updated : tool));
      });
      return next;
    });
    setPendingTools((prev) =>
      prev.map((tool) => (tool.id === toolId ? updated : tool))
    );
    notify('Tool favorite updated.');
  };

  const handleSubmitTool = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    try {
      const tags = formState.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      await api.createToolLibraryTool({
        name: formState.name.trim(),
        description: formState.description.trim(),
        website_url: formState.website_url.trim() || undefined,
        preview_image_url: formState.preview_image_url.trim() || undefined,
        category_id: formState.category_id || undefined,
        tags,
        pricing_type: formState.pricing_type,
        is_internal: formState.is_internal,
      });
      setFormSuccess('Tool submitted for approval.');
      setFormState(emptyForm);
      setIsAddToolOpen(false);
      notify('Tool submitted for approval.');
      if (activeTab === 'library') {
        if (isFiltering) {
          void loadFilteredTools();
        } else {
          void loadCategories();
        }
      }
      if (activeTab === 'approvals') {
        void loadPendingTools();
      }
    } catch (error) {
      setFormError('Unable to submit tool. Please try again.');
    }
  };

  const handleCategoryUpdate = async (categoryId: string, payload: Partial<ToolCategory>) => {
    await api.updateToolLibraryCategory(categoryId, {
      name: payload.name,
      description: payload.description ?? undefined,
      display_order: payload.display_order,
      status: payload.status,
    });
    await loadAdminCategories();
    await loadCategoryOptions();
    notify('Category updated successfully.');
  };

  const handleArchiveCategory = async (categoryId: string) => {
    await api.archiveToolLibraryCategory(categoryId);
    await loadAdminCategories();
    await loadCategoryOptions();
    notify('Category archived.');
  };

  const handleCreateCategory = async () => {
    setNewCategoryError(null);
    if (!newCategory.name.trim()) {
      setNewCategoryError('Category name is required.');
      return;
    }
    try {
      await api.createToolLibraryCategory({
        name: newCategory.name.trim(),
        description: newCategory.description.trim() || undefined,
        display_order: newCategory.display_order,
        status: newCategory.status,
      });
      setNewCategory({
        name: '',
        description: '',
        display_order: 0,
        status: ToolCategoryStatus.ACTIVE,
      });
      await loadAdminCategories();
      await loadCategoryOptions();
      notify('Category created successfully.');
    } catch (error) {
      setNewCategoryError('Unable to create category.');
    }
  };

  const handleMoveCategory = async (categoryId: string, direction: 'up' | 'down') => {
    const sorted = [...adminCategories].sort(
      (a, b) => a.display_order - b.display_order
    );
    const index = sorted.findIndex((category) => category.id === categoryId);
    if (index === -1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const current = sorted[index];
    const target = sorted[swapIndex];
    await Promise.all([
      api.updateToolLibraryCategory(current.id, { display_order: target.display_order }),
      api.updateToolLibraryCategory(target.id, { display_order: current.display_order }),
    ]);
    await loadAdminCategories();
    await loadCategoryOptions();
    notify('Category order updated.');
  };

  const handleDecision = async () => {
    if (!decisionState) return;
    const action = decisionState.action;
    setDecisionError(null);
    try {
      if (decisionState.action === 'approve') {
        await api.approveToolLibraryTool(decisionState.tool.id, {
          reason: decisionReason.trim() || undefined,
        });
      } else {
        await api.rejectToolLibraryTool(decisionState.tool.id, {
          reason: decisionReason.trim() || undefined,
        });
      }
      setDecisionState(null);
      setDecisionReason('');
      await loadPendingTools();
      notify(action === 'approve' ? 'Tool approved.' : 'Tool rejected.');
    } catch (error) {
      setDecisionError('Unable to update tool status.');
    }
  };

  const handleViewAllCategory = (categoryId: string) => {
    setFilterCategoryId(categoryId);
    setFilterTag('');
    setFilterPricing('');
  };

  if (libraryLoading && categories.length === 0 && !isFiltering) {
    return <PageLoader />;
  }

  return (
    <div className="space-y-6 p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/50">Library</p>
          <h1 className="text-2xl font-semibold text-white">Tool Library</h1>
          <p className="text-sm text-white/60">
            Discover internal tools and community submissions. Every tool is approved before it goes live.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <div className="flex rounded-full border border-white/10 bg-white/5 p-1 text-xs">
              {(['library', 'categories', 'approvals'] as AdminTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full px-3 py-1 transition ${
                    activeTab === tab ? 'bg-white/15 text-white' : 'text-white/60'
                  }`}
                >
                  {tab === 'library' && 'Library'}
                  {tab === 'categories' && 'Manage Categories'}
                  {tab === 'approvals' && 'Pending Approvals'}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setIsAddToolOpen(true)}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white hover:border-white/30"
          >
            <PlusIcon className="h-4 w-4" />
            Add Tool
          </button>
        </div>
      </div>

      {activeTab === 'library' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-4 md:flex-row md:items-center">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tools by name or purpose"
                className="w-full rounded-full border border-white/10 bg-black/30 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/40"
              />
            </div>
            <select
              value={filterCategoryId}
              onChange={(event) => setFilterCategoryId(event.target.value)}
              className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white md:w-56"
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              value={filterTag}
              onChange={(event) => setFilterTag(event.target.value)}
              className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white md:w-48"
            >
              <option value="">All tags</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <select
              value={filterPricing}
              onChange={(event) => setFilterPricing(event.target.value as ToolPricingType | '')}
              className="w-full rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-white md:w-40"
            >
              <option value="">All pricing</option>
              <option value={ToolPricingType.FREE}>Free</option>
              <option value={ToolPricingType.TRIAL}>Trial</option>
              <option value={ToolPricingType.PAID}>Paid</option>
            </select>
          </div>

          {isFiltering ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">Filtered tools</p>
                  <p className="text-sm text-white/60">Use filters to narrow down what you want.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setFilterCategoryId('');
                    setFilterTag('');
                    setFilterPricing('');
                  }}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:border-white/30"
                >
                  Clear filters
                </button>
              </div>
              {filteredLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
                  Loading tools...
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {filteredTools.map((tool) => (
                    <ToolCard key={tool.id} tool={tool} onToggleFavorite={handleToggleFavorite} />
                  ))}
                </div>
              )}
              {filteredTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 text-xs text-white/60">
                  <button
                    type="button"
                    onClick={() => setFilteredPage((prev) => Math.max(1, prev - 1))}
                    className="rounded-full border border-white/10 px-3 py-1 hover:border-white/30"
                    disabled={filteredPage === 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {filteredPage} of {filteredTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFilteredPage((prev) => Math.min(filteredTotalPages, prev + 1))}
                    className="rounded-full border border-white/10 px-3 py-1 hover:border-white/30"
                    disabled={filteredPage === filteredTotalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {libraryLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
                  Loading categories...
                </div>
              ) : (
                categories.map((category) => (
                  <div key={category.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-white">{category.name}</h2>
                        <p className="text-sm text-white/60">
                          {category.description || 'Curated tools for this workflow.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleViewAllCategory(category.id)}
                        className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:border-white/30"
                      >
                        View all
                      </button>
                    </div>
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {(toolsByCategory[category.id] ?? []).map((tool) => (
                        <div key={tool.id} className="min-w-[240px] max-w-[260px] flex-1">
                          <ToolCard tool={tool} onToggleFavorite={handleToggleFavorite} />
                        </div>
                      ))}
                      {(toolsByCategory[category.id] ?? []).length === 0 && (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/50">
                          No tools yet.
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {categoryTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 text-xs text-white/60">
                  <button
                    type="button"
                    onClick={() => setCategoryPage((prev) => Math.max(1, prev - 1))}
                    className="rounded-full border border-white/10 px-3 py-1 hover:border-white/30"
                    disabled={categoryPage === 1}
                  >
                    Prev
                  </button>
                  <span>
                    Page {categoryPage} of {categoryTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCategoryPage((prev) => Math.min(categoryTotalPages, prev + 1))}
                    className="rounded-full border border-white/10 px-3 py-1 hover:border-white/30"
                    disabled={categoryPage === categoryTotalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {activeTab === 'categories' && isAdmin && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Admin</p>
              <h2 className="text-lg font-semibold text-white">Manage Categories</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsAddToolOpen(true)}
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:border-white/30"
            >
              Add tool instead
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">New category</p>
            <div className="mt-3 grid gap-3 md:grid-cols-4">
              <input
                type="text"
                value={newCategory.name}
                onChange={(event) =>
                  setNewCategory((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Category name"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white md:col-span-2"
              />
              <input
                type="number"
                value={newCategory.display_order}
                onChange={(event) =>
                  setNewCategory((prev) => ({
                    ...prev,
                    display_order: Number(event.target.value),
                  }))
                }
                placeholder="Order"
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <select
                value={newCategory.status}
                onChange={(event) =>
                  setNewCategory((prev) => ({
                    ...prev,
                    status: event.target.value as ToolCategoryStatus,
                  }))
                }
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              >
                <option value={ToolCategoryStatus.ACTIVE}>Active</option>
                <option value={ToolCategoryStatus.ARCHIVED}>Archived</option>
              </select>
            </div>
            <textarea
              value={newCategory.description}
              onChange={(event) =>
                setNewCategory((prev) => ({ ...prev, description: event.target.value }))
              }
              rows={2}
              placeholder="Description"
              className="mt-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80"
            />
            {newCategoryError && (
              <p className="mt-2 text-xs text-rose-200">{newCategoryError}</p>
            )}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={handleCreateCategory}
                className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white"
              >
                Create category
              </button>
            </div>
          </div>
          {adminCategoriesLoading ? (
            <div className="text-sm text-white/60">Loading categories...</div>
          ) : (
            <div className="space-y-4">
              {adminCategories.map((category) => (
                <div
                  key={category.id}
                  className="rounded-xl border border-white/10 bg-black/30 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        value={category.name}
                        onChange={(event) =>
                          setAdminCategories((prev) =>
                            prev.map((item) =>
                              item.id === category.id
                                ? { ...item, name: event.target.value }
                                : item
                            )
                          )
                        }
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                      />
                      <textarea
                        value={category.description ?? ''}
                        onChange={(event) =>
                          setAdminCategories((prev) =>
                            prev.map((item) =>
                              item.id === category.id
                                ? { ...item, description: event.target.value }
                                : item
                            )
                          )
                        }
                        rows={2}
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/80"
                        placeholder="Describe the category"
                      />
                      <div className="flex flex-wrap gap-2 text-xs text-white/60">
                        <span>Order:</span>
                        <input
                          type="number"
                          value={category.display_order}
                          onChange={(event) =>
                            setAdminCategories((prev) =>
                              prev.map((item) =>
                                item.id === category.id
                                  ? { ...item, display_order: Number(event.target.value) }
                                  : item
                              )
                            )
                          }
                          className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white"
                        />
                        <select
                          value={category.status}
                          onChange={(event) =>
                            setAdminCategories((prev) =>
                              prev.map((item) =>
                                item.id === category.id
                                  ? { ...item, status: event.target.value as ToolCategoryStatus }
                                  : item
                              )
                            )
                          }
                          className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-white"
                        >
                          <option value={ToolCategoryStatus.ACTIVE}>Active</option>
                          <option value={ToolCategoryStatus.ARCHIVED}>Archived</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => handleCategoryUpdate(category.id, category)}
                        className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/70 hover:border-white/30"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveCategory(category.id, 'up')}
                        className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/60 hover:border-white/30"
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveCategory(category.id, 'down')}
                        className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/60 hover:border-white/30"
                      >
                        Move down
                      </button>
                      <button
                        type="button"
                        onClick={() => handleArchiveCategory(category.id)}
                        className="rounded-full border border-rose-500/40 px-4 py-2 text-xs text-rose-200 hover:border-rose-400/70"
                      >
                        Archive
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {adminCategories.length === 0 && (
                <div className="text-sm text-white/60">No categories found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'approvals' && isAdmin && (
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">Admin</p>
            <h2 className="text-lg font-semibold text-white">Pending Tool Approvals</h2>
            <p className="text-sm text-white/60">
              Review submitted tools and approve or reject them with a reason.
            </p>
          </div>
          {pendingLoading ? (
            <div className="text-sm text-white/60">Loading tools...</div>
          ) : (
            <div className="space-y-3">
              {pendingTools.map((tool) => (
                <div
                  key={tool.id}
                  className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/30 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-white">{tool.name}</h3>
                    <p className="text-xs text-white/60">{tool.description}</p>
                    <p className="text-xs text-white/40">Submitted by {tool.created_by}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDecisionState({ tool, action: 'approve' })}
                      className="rounded-full border border-emerald-500/40 px-4 py-2 text-xs text-emerald-200 hover:border-emerald-400/70"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisionState({ tool, action: 'reject' })}
                      className="rounded-full border border-rose-500/40 px-4 py-2 text-xs text-rose-200 hover:border-rose-400/70"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {pendingTools.length === 0 && (
                <div className="text-sm text-white/60">No pending tools.</div>
              )}
            </div>
          )}
        </div>
      )}

      {isAddToolOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0b1224] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">Submit</p>
                <h2 className="text-lg font-semibold text-white">Add a new tool</h2>
                <p className="text-sm text-white/60">
                  Every tool goes through an approval review before it appears in the library.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAddToolOpen(false)}
                className="text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>
            <form onSubmit={handleSubmitTool} className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Tool name"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                />
                <select
                  value={formState.category_id}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, category_id: event.target.value }))
                  }
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                >
                  <option value="">Select category</option>
                  {categoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                required
                value={formState.description}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Describe what this tool is for"
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
              />
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  type="url"
                  value={formState.website_url}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, website_url: event.target.value }))
                  }
                  placeholder="Website URL"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                />
                <input
                  type="url"
                  value={formState.preview_image_url}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, preview_image_url: event.target.value }))
                  }
                  placeholder="Preview image URL"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  type="text"
                  value={formState.tags}
                  onChange={(event) => setFormState((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="Tags (comma separated)"
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white md:col-span-2"
                />
                <select
                  value={formState.pricing_type}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      pricing_type: event.target.value as ToolPricingType,
                    }))
                  }
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                >
                  <option value={ToolPricingType.FREE}>Free</option>
                  <option value={ToolPricingType.TRIAL}>Trial</option>
                  <option value={ToolPricingType.PAID}>Paid</option>
                </select>
              </div>
              {isAdmin && (
                <label className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={formState.is_internal}
                    onChange={(event) =>
                      setFormState((prev) => ({ ...prev, is_internal: event.target.checked }))
                    }
                  />
                  Internal only tool
                </label>
              )}
              {formError && <p className="text-xs text-rose-200">{formError}</p>}
              {formSuccess && <p className="text-xs text-emerald-200">{formSuccess}</p>}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddToolOpen(false)}
                  className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/60 hover:border-white/30"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white"
                >
                  Submit tool
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {decisionState && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0b1224] p-6">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">Review</p>
              <h2 className="text-lg font-semibold text-white">
                {decisionState.action === 'approve' ? 'Approve tool' : 'Reject tool'}
              </h2>
              <p className="text-sm text-white/60">
                {decisionState.tool.name}
              </p>
            </div>
            <textarea
              rows={3}
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              placeholder="Add a reason (optional)"
              className="mt-4 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
            {decisionError && <p className="mt-2 text-xs text-rose-200">{decisionError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDecisionState(null)}
                className="rounded-full border border-white/10 px-4 py-2 text-xs text-white/60 hover:border-white/30"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDecision}
                className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
const ToolCard: React.FC<{ tool: Tool; onToggleFavorite: (toolId: string) => void }> = ({
  tool,
  onToggleFavorite,
}) => {
  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-white/10 bg-black/40 p-4 text-left">
      <div className="space-y-3">
        <div className="h-28 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-indigo-500/20 via-slate-900/40 to-emerald-400/20">
          {tool.preview_image_url ? (
            <img
              src={tool.preview_image_url}
              alt={tool.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/50">
              Preview coming soon
            </div>
          )}
        </div>
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">{tool.name}</h3>
              <p className="text-xs text-white/60 line-clamp-2">{tool.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onToggleFavorite(tool.id)}
              className="rounded-full border border-white/10 p-2 text-white/60 hover:border-white/30"
              aria-label="Toggle favorite"
            >
              {tool.is_favorite ? (
                <StarIconSolid className="h-4 w-4 text-amber-300" />
              ) : (
                <StarIconOutline className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/60">
            {tool.tags?.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full border border-white/10 px-2 py-1">
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/60">
          {tool.pricing_type}
        </span>
        {tool.website_url ? (
          <a
            href={tool.website_url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
          >
            Access Tool
          </a>
        ) : (
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/40">
            No link
          </span>
        )}
      </div>
    </div>
  );
};

export default ToolLibrary;
