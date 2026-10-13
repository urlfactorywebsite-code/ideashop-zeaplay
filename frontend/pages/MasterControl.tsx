import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import type { FeatureFlag, FeatureFlagUpdate } from '../types';

const DEFAULT_FLAGS: FeatureFlag[] = [
  { key: 'page.dashboard', label: 'Dashboard Page', group: 'Pages', description: 'Show the dashboard page.', enabled: true },
  { key: 'page.tasks', label: 'Tasks Page', group: 'Pages', description: 'Show the task list page.', enabled: true },
  { key: 'page.kanban', label: 'Kanban Board Page', group: 'Pages', description: 'Show the kanban board.', enabled: true },
  { key: 'page.calendar', label: 'Calendar Page', group: 'Pages', description: 'Show the calendar view.', enabled: true },
  { key: 'page.gantt', label: 'Gantt Page', group: 'Pages', description: 'Show the gantt chart.', enabled: true },
  { key: 'page.reports', label: 'Reports Page', group: 'Pages', description: 'Show the reports hub.', enabled: true },
  { key: 'page.logs', label: 'Logs Page', group: 'Pages', description: 'Show system logs.', enabled: true },
  { key: 'page.media', label: 'Media Library Page', group: 'Pages', description: 'Show the media library.', enabled: true },
  { key: 'page.tool_library', label: 'Tool Library Page', group: 'Pages', description: 'Show the tool library.', enabled: true },
  { key: 'page.tickets', label: 'Tickets Page', group: 'Pages', description: 'Show ticket management.', enabled: true },
  { key: 'page.chat', label: 'Chat Page', group: 'Pages', description: 'Show chat module.', enabled: true },
  { key: 'page.achievements', label: 'Achievements Page', group: 'Pages', description: 'Show achievements.', enabled: true },
  { key: 'page.levels', label: 'Levels Page', group: 'Pages', description: 'Show levels manager.', enabled: true },
  { key: 'page.rewards', label: 'Rewards Page', group: 'Pages', description: 'Show rewards hub.', enabled: true },
  { key: 'page.points_table', label: 'Points Table Page', group: 'Pages', description: 'Show points table.', enabled: true },
  { key: 'page.template_editor', label: 'Template Editor Page', group: 'Pages', description: 'Show template editor.', enabled: true },
  { key: 'page.api_overview', label: 'API Overview Page', group: 'Pages', description: 'Show API overview.', enabled: true },
  { key: 'page.users_admin', label: 'Users Admin Page', group: 'Pages', description: 'Show user administration.', enabled: true },
  { key: 'page.settings', label: 'Settings Page', group: 'Pages', description: 'Show settings page.', enabled: true },
  { key: 'page.master_control', label: 'Master Control Page', group: 'Pages', description: 'Show master control.', enabled: true },
  { key: 'tasks.create', label: 'Create Tasks', group: 'Tasks', description: 'Allow creating new tasks.', enabled: true },
  { key: 'tasks.edit', label: 'Edit Tasks', group: 'Tasks', description: 'Allow editing tasks.', enabled: true },
  { key: 'tasks.delete', label: 'Delete Tasks', group: 'Tasks', description: 'Allow deleting tasks.', enabled: true },
  { key: 'tasks.assign', label: 'Assign Tasks', group: 'Tasks', description: 'Allow assigning tasks.', enabled: true },
  { key: 'tasks.bulk_actions', label: 'Bulk Actions', group: 'Tasks', description: 'Allow bulk task actions.', enabled: true },
  { key: 'tasks.priorities', label: 'Priority Controls', group: 'Tasks', description: 'Allow setting priorities.', enabled: true },
  { key: 'tasks.statuses', label: 'Status Controls', group: 'Tasks', description: 'Allow status changes.', enabled: true },
  { key: 'tasks.tags', label: 'Tag Filters', group: 'Tasks', description: 'Allow tagging and tag filters.', enabled: true },
  { key: 'tasks.due_dates', label: 'Due Dates', group: 'Tasks', description: 'Allow due dates.', enabled: true },
  { key: 'tasks.recurring', label: 'Recurring Tasks', group: 'Tasks', description: 'Allow recurring rules.', enabled: true },
  { key: 'tasks.approvals', label: 'Task Approvals', group: 'Tasks', description: 'Enable task approvals.', enabled: true },
  { key: 'tasks.points', label: 'Task Points', group: 'Tasks', description: 'Enable points for tasks.', enabled: true },
  { key: 'tasks.templates', label: 'Task Templates', group: 'Tasks', description: 'Enable templates module.', enabled: true },
  { key: 'tasks.template_create_button', label: 'Template Create Button', group: 'Tasks', description: 'Show template create button.', enabled: true },
  { key: 'tasks.attachments', label: 'Attachments', group: 'Tasks', description: 'Allow file attachments.', enabled: true },
  { key: 'tasks.comments', label: 'Task Comments', group: 'Tasks', description: 'Enable comments.', enabled: true },
  { key: 'tasks.time_tracking', label: 'Time Tracking', group: 'Tasks', description: 'Enable time tracking.', enabled: true },
  { key: 'tasks.checklists', label: 'Checklists', group: 'Tasks', description: 'Enable checklists.', enabled: true },
  { key: 'tasks.subtasks', label: 'Subtasks', group: 'Tasks', description: 'Enable subtasks.', enabled: true },
  { key: 'tasks.export', label: 'Export Tasks', group: 'Tasks', description: 'Allow export.', enabled: true },
  { key: 'tasks.import', label: 'Import Tasks', group: 'Tasks', description: 'Allow import.', enabled: true },
  { key: 'kanban.drag_drop', label: 'Drag & Drop', group: 'Kanban', description: 'Enable drag and drop.', enabled: true },
  { key: 'kanban.create_columns', label: 'Create Columns', group: 'Kanban', description: 'Allow creating columns.', enabled: true },
  { key: 'kanban.edit_columns', label: 'Edit Columns', group: 'Kanban', description: 'Allow editing columns.', enabled: true },
  { key: 'kanban.wip_limits', label: 'WIP Limits', group: 'Kanban', description: 'Enable WIP limits.', enabled: true },
  { key: 'kanban.quick_filters', label: 'Quick Filters', group: 'Kanban', description: 'Show quick filters.', enabled: true },
  { key: 'kanban.status_tooltips', label: 'Status Tooltips', group: 'Kanban', description: 'Show status tooltips.', enabled: true },
  { key: 'kanban.view_modes', label: 'View Modes', group: 'Kanban', description: 'Enable list/grid/kanban modes.', enabled: true },
  { key: 'kanban.bulk_move', label: 'Bulk Move', group: 'Kanban', description: 'Enable bulk move.', enabled: true },
  { key: 'tickets.create', label: 'Create Tickets', group: 'Tickets', description: 'Allow creating tickets.', enabled: true },
  { key: 'tickets.assign', label: 'Assign Tickets', group: 'Tickets', description: 'Allow assigning tickets.', enabled: true },
  { key: 'tickets.close', label: 'Close Tickets', group: 'Tickets', description: 'Allow closing tickets.', enabled: true },
  { key: 'tickets.reopen', label: 'Reopen Tickets', group: 'Tickets', description: 'Allow reopening tickets.', enabled: true },
  { key: 'tickets.sla', label: 'SLA Tracking', group: 'Tickets', description: 'Enable SLA tracking.', enabled: true },
  { key: 'tickets.attachments', label: 'Ticket Attachments', group: 'Tickets', description: 'Enable attachments.', enabled: true },
  { key: 'tickets.chat', label: 'Ticket Chat', group: 'Tickets', description: 'Enable ticket chat.', enabled: true },
  { key: 'tickets.priority', label: 'Ticket Priority', group: 'Tickets', description: 'Allow priorities.', enabled: true },
  { key: 'tickets.categories', label: 'Ticket Categories', group: 'Tickets', description: 'Allow categories.', enabled: true },
  { key: 'tickets.approvals', label: 'Ticket Approvals', group: 'Tickets', description: 'Enable approvals.', enabled: true },
  { key: 'rewards.redeem', label: 'Redeem Rewards', group: 'Rewards', description: 'Allow redeeming rewards.', enabled: true },
  { key: 'rewards.seasonal', label: 'Seasonal Rewards', group: 'Rewards', description: 'Enable seasonal rewards.', enabled: true },
  { key: 'rewards.badges', label: 'Badges', group: 'Rewards', description: 'Enable badges.', enabled: true },
  { key: 'rewards.achievements', label: 'Achievements', group: 'Rewards', description: 'Enable achievements.', enabled: true },
  { key: 'rewards.points_table', label: 'Points Table', group: 'Rewards', description: 'Show points table.', enabled: true },
  { key: 'rewards.leaderboard', label: 'Leaderboard', group: 'Rewards', description: 'Show leaderboard.', enabled: true },
  { key: 'rewards.daily_bonus', label: 'Daily Bonus', group: 'Rewards', description: 'Enable daily bonus.', enabled: true },
  { key: 'admin.user_management', label: 'User Management', group: 'Admin', description: 'Enable user management.', enabled: true },
  { key: 'admin.role_management', label: 'Role Management', group: 'Admin', description: 'Enable role management.', enabled: true },
  { key: 'admin.permissions_matrix', label: 'Permissions Matrix', group: 'Admin', description: 'Enable permissions matrix.', enabled: true },
  { key: 'admin.audit_logs', label: 'Audit Logs', group: 'Admin', description: 'Enable audit logs.', enabled: true },
  { key: 'admin.data_admin', label: 'Data Admin', group: 'Admin', description: 'Enable data admin tools.', enabled: true },
  { key: 'admin.integrations', label: 'Integrations', group: 'Admin', description: 'Enable integrations.', enabled: true },
  { key: 'admin.webhooks', label: 'Webhooks', group: 'Admin', description: 'Enable webhooks.', enabled: true },
  { key: 'admin.api_keys', label: 'API Keys', group: 'Admin', description: 'Enable API keys.', enabled: true },
  { key: 'admin.sso', label: 'SSO', group: 'Admin', description: 'Enable SSO.', enabled: true },
  { key: 'permissions.user_active', label: 'User Active', group: 'User Permissions', description: 'Allow active users.', enabled: true },
  { key: 'permissions.user_deactivated', label: 'User Deactivated', group: 'User Permissions', description: 'Allow deactivated users.', enabled: true },
  { key: 'permissions.manager_access', label: 'Manager Access', group: 'User Permissions', description: 'Enable manager access.', enabled: true },
  { key: 'permissions.admin_access', label: 'Admin Access', group: 'User Permissions', description: 'Enable admin access.', enabled: true },
  { key: 'permissions.owner_access', label: 'Owner Access', group: 'User Permissions', description: 'Enable owner access.', enabled: true },
  { key: 'permissions.export', label: 'Export Permission', group: 'User Permissions', description: 'Allow exports.', enabled: true },
  { key: 'permissions.import', label: 'Import Permission', group: 'User Permissions', description: 'Allow imports.', enabled: true },
  { key: 'comm.notifications', label: 'In-App Notifications', group: 'Communication', description: 'Enable in-app notifications.', enabled: true },
  { key: 'comm.email', label: 'Email Notifications', group: 'Communication', description: 'Enable email alerts.', enabled: true },
  { key: 'comm.sms', label: 'SMS Alerts', group: 'Communication', description: 'Enable SMS alerts.', enabled: true },
  { key: 'comm.chat', label: 'Chat Module', group: 'Communication', description: 'Enable chat module.', enabled: true },
  { key: 'comm.in_app', label: 'In-App Messages', group: 'Communication', description: 'Enable in-app messaging.', enabled: true },
];

const MasterControl: React.FC = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const resolvedTheme = theme === 'system' ? 'dark' : theme;
  const isLight = resolvedTheme === 'light';
  const isColorful = resolvedTheme === 'colorful';

  useEffect(() => {
    let isMounted = true;
    api
      .getFeatureFlags()
      .then((data: FeatureFlag[]) => {
        if (!isMounted) return;
        setFlags(data.length ? data : DEFAULT_FLAGS);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        console.error('Failed to load feature flags:', err);
        setFlags(DEFAULT_FLAGS);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const groupedFlags = useMemo(() => {
    const list = flags.length ? flags : DEFAULT_FLAGS;
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = normalizedSearch
      ? list.filter(
          (flag) =>
            flag.label.toLowerCase().includes(normalizedSearch) ||
            flag.group.toLowerCase().includes(normalizedSearch) ||
            flag.key.toLowerCase().includes(normalizedSearch),
        )
      : list;
    return filtered.reduce<Record<string, FeatureFlag[]>>((acc, flag) => {
      if (!acc[flag.group]) acc[flag.group] = [];
      acc[flag.group].push(flag);
      return acc;
    }, {});
  }, [flags, search]);

  const toggleClasses = isLight
    ? 'bg-slate-200 border-slate-300'
    : isColorful
      ? 'bg-slate-950/80 border-fuchsia-300/40'
      : 'bg-slate-950/80 border-cyan-300/40';
  const toggleActive = isLight
    ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.45)]'
    : isColorful
      ? 'bg-fuchsia-500 shadow-[0_0_12px_rgba(217,70,239,0.45)]'
      : 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)]';

  const handleToggle = async (flag: FeatureFlag) => {
    const nextEnabled = !flag.enabled;
    setFlags((prev) => prev.map((item) => (item.key === flag.key ? { ...item, enabled: nextEnabled } : item)));
    setIsSaving(true);
    setError('');
    const payload: FeatureFlagUpdate[] = [{ key: flag.key, enabled: nextEnabled }];
    try {
      const updated = await api.updateFeatureFlags(payload, user?.id ?? '');
      setFlags(updated.length ? updated : DEFAULT_FLAGS);
    } catch (err) {
      console.error('Failed to update feature flag:', err);
      setError('Unable to save changes. Try again.');
      setFlags((prev) => prev.map((item) => (item.key === flag.key ? { ...item, enabled: !nextEnabled } : item)));
    } finally {
      setIsSaving(false);
    }
  };

  const headerClass = isLight
    ? 'text-slate-900'
    : isColorful
      ? 'text-fuchsia-100'
      : 'text-cyan-100';
  const textMain = isLight ? 'text-slate-900' : 'text-white';
  const textMuted = isLight ? 'text-slate-600' : 'text-white/60';
  const panelClass = isLight
    ? 'border-slate-200 bg-white/80 shadow-[0_20px_45px_rgba(15,23,42,0.12)]'
    : isColorful
      ? 'border-fuchsia-300/30 bg-slate-950/85 shadow-[0_24px_54px_rgba(91,33,182,0.5)]'
      : 'border-cyan-400/25 bg-slate-950/90 shadow-[0_24px_54px_rgba(8,145,178,0.35)]';
  const cardClass = isLight
    ? 'border-slate-200 bg-white/90'
    : isColorful
      ? 'border-fuchsia-300/30 bg-slate-950/80'
      : 'border-cyan-400/20 bg-slate-950/85';

  return (
    <div className="space-y-6">
      <div className={`rounded-3xl border p-6 ${panelClass}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className={`text-[10px] uppercase tracking-[0.5em] ${textMuted}`}>Master Control</p>
            <h1 className={`text-2xl font-semibold ${headerClass}`}>Feature Gatekeeper</h1>
            <p className={`text-sm ${textMuted}`}>
              Toggle every module, page, and permission by plan.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search features"
              className={`rounded-full border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${
                isLight
                  ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-500'
                  : 'border-white/10 bg-black/40 text-white placeholder:text-white/60'
              }`}
            />
            {error && <span className="text-xs text-rose-200">{error}</span>}
            {isSaving && <span className="text-xs text-cyan-200">Saving updates...</span>}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(groupedFlags).map(([groupName, groupFlags]) => (
          <div key={groupName} className={`rounded-2xl border p-5 ${cardClass}`}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className={`text-lg font-semibold ${headerClass}`}>{groupName}</h2>
              <span className={`text-xs ${textMuted}`}>{groupFlags.length} toggles</span>
            </div>
            <div className="space-y-4">
              {groupFlags.map((flag) => (
                <div key={flag.key} className="flex items-start justify-between gap-4">
                  <div>
                    <p className={`text-sm font-semibold ${textMain}`}>{flag.label}</p>
                    {flag.description && <p className={`text-xs ${textMuted}`}>{flag.description}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggle(flag)}
                    className={`relative h-6 w-12 rounded-full border ${toggleClasses} transition`}
                    aria-pressed={flag.enabled}
                  >
                    <span
                      className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition ${
                        flag.enabled ? 'translate-x-6' : ''
                      } ${flag.enabled ? toggleActive : ''}`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MasterControl;
