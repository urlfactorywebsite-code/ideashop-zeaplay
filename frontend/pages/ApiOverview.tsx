import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
    ArrowRightIcon,
    ChartBarIcon,
    CheckCircleIcon,
    ClipboardDocumentListIcon,
    CodeBracketSquareIcon,
    Cog6ToothIcon,
    DocumentTextIcon,
    EnvelopeIcon,
    KeyIcon,
    PlusIcon,
    SparklesIcon,
    TrashIcon,
    UserIcon,
} from '../components/icons';
import MultiSelect from '../components/ui/MultiSelect';
import api from '../services/mockApi';
import type { WebhookSubscription, WebhookTestResult } from '../types';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface EndpointDoc {
    id: string;
    method: HttpMethod;
    path: string;
    title: string;
    summary: string;
    requiresAuth?: boolean;
    scopes?: string[];
    headers?: Array<{ key: string; value: string; description?: string }>;
    queryParams?: Array<{ key: string; value?: string; description?: string }>;
    bodyExample?: Record<string, unknown> | null;
    responseExample?: Record<string, unknown> | null;
}

interface EndpointGroup {
    category: string;
    description: string;
    endpoints: EndpointDoc[];
}

interface ScopeCatalogEntry {
    id: string;
    description: string;
    category: string;
}

interface GeneratedKeyRecord {
    id: string;
    label: string;
    key: string;
    scopes: string[];
    baseUrl: string;
    createdAt: string;
    expiresAt?: string;
    subject?: string;
}

interface WebhookEvent {
    id: string;
    label: string;
    description: string;
}

interface WebhookEventGroup {
    id: string;
    label: string;
    description: string;
    events: WebhookEvent[];
}

interface WebhookHeaderInput {
    id: string;
    key: string;
    value: string;
}

interface WebhookDraft {
    id?: string;
    name: string;
    urls: string[];
    subscribedEvents: string[];
    isEnabled: boolean;
    customHeaders: WebhookHeaderInput[];
}

const KEY_HISTORY_STORAGE_KEY = 'zea-play::bearer-key-history';
const MAX_KEY_HISTORY = 10;
const IS_DEV_MODE = import.meta.env.MODE === 'development';

const createLocalId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const buildEmptyWebhookDraft = (): WebhookDraft => ({
    name: '',
    urls: [''],
    subscribedEvents: [],
    isEnabled: true,
    customHeaders: [{ id: createLocalId(), key: '', value: '' }],
});

const WEBHOOK_EVENT_GROUPS: WebhookEventGroup[] = [
    {
        id: 'tickets',
        label: 'Tickets',
        description: 'Support ticket lifecycle updates.',
        events: [
            { id: 'ticket.created', label: 'Ticket created', description: 'A new ticket is created.' },
            { id: 'ticket.updated', label: 'Ticket updated', description: 'Ticket fields are updated.' },
            { id: 'ticket.status_changed', label: 'Status changed', description: 'Ticket status transitions.' },
            { id: 'ticket.assigned', label: 'Ticket assigned', description: 'Ticket is assigned to an owner.' },
            { id: 'ticket.closed', label: 'Ticket closed', description: 'Ticket is marked as closed.' },
            { id: 'ticket.reopened', label: 'Ticket reopened', description: 'Ticket is reopened by a user.' },
            { id: 'ticket.mentioned', label: 'Ticket mentioned', description: 'User mentioned in a ticket comment.' },
            { id: 'ticket.approval_requested', label: 'Approval requested', description: 'Approval cycle is requested.' },
            { id: 'ticket.approval_approved', label: 'Approval approved', description: 'Approval cycle is approved.' },
            { id: 'ticket.approval_rejected', label: 'Approval rejected', description: 'Approval cycle is rejected.' },
            { id: 'ticket.approval_overdue', label: 'Approval overdue', description: 'Approval deadline passed.' },
            { id: 'ticket.approval_escalated', label: 'Approval escalated', description: 'Approval escalated to owner.' },
            { id: 'ticket.task_created', label: 'Ticket task created', description: 'Ticket-linked task created.' },
            { id: 'ticket.task_updated', label: 'Ticket task updated', description: 'Ticket-linked task updated.' },
            { id: 'ticket.task_completed', label: 'Ticket task completed', description: 'Ticket-linked task completed.' },
            { id: 'ticket.task_deleted', label: 'Ticket task deleted', description: 'Ticket-linked task deleted.' },
        ],
    },
    {
        id: 'tasks',
        label: 'Tasks',
        description: 'Task lifecycle updates and assignments.',
        events: [
            { id: 'task.created', label: 'Task created', description: 'A new task is created.' },
            { id: 'task.updated', label: 'Task updated', description: 'Task details are updated.' },
            { id: 'task.completed', label: 'Task completed', description: 'Task is marked complete.' },
            { id: 'task.deleted', label: 'Task deleted', description: 'Task is removed from the workspace.' },
            { id: 'task.subtask_updated', label: 'Subtask updated', description: 'Subtask progress changes.' },
        ],
    },
    {
        id: 'comments',
        label: 'Comments',
        description: 'Task discussion updates.',
        events: [
            { id: 'comment.created', label: 'Comment created', description: 'A new comment is posted.' },
            { id: 'comment.deleted', label: 'Comment deleted', description: 'A comment is removed.' },
        ],
    },
    {
        id: 'users',
        label: 'Users',
        description: 'Workspace user provisioning.',
        events: [
            { id: 'user.created', label: 'User created', description: 'A new user joins the workspace.' },
            { id: 'user.updated', label: 'User updated', description: 'User profile changes.' },
            { id: 'user.deleted', label: 'User deleted', description: 'User is removed from the workspace.' },
        ],
    },
    {
        id: 'rewards',
        label: 'Rewards',
        description: 'Reward catalog and claims.',
        events: [
            { id: 'reward.created', label: 'Reward created', description: 'A new reward is published.' },
            { id: 'reward.updated', label: 'Reward updated', description: 'Reward details change.' },
            { id: 'reward.deleted', label: 'Reward deleted', description: 'Reward is removed.' },
            { id: 'reward.expired', label: 'Reward expired', description: 'Reward expiration triggered.' },
            { id: 'reward.claimed', label: 'Reward claimed', description: 'Reward claim submitted.' },
        ],
    },
    {
        id: 'notifications',
        label: 'Notifications',
        description: 'System notifications sent to users.',
        events: [
            { id: 'notification.created', label: 'Notification created', description: 'A notification is issued.' },
        ],
    },
    {
        id: 'points',
        label: 'Points Table',
        description: 'Points table configuration changes.',
        events: [
            { id: 'points_table.created', label: 'Points table created', description: 'Points rules created.' },
            { id: 'points_table.updated', label: 'Points table updated', description: 'Points rules updated.' },
        ],
    },
    {
        id: 'departments',
        label: 'Departments',
        description: 'Organization structure changes.',
        events: [
            { id: 'department.created', label: 'Department created', description: 'A department is created.' },
            { id: 'department.deleted', label: 'Department deleted', description: 'A department is removed.' },
        ],
    },
    {
        id: 'dev',
        label: 'Developer',
        description: 'Developer-only events.',
        events: [
            { id: 'test', label: 'Manual test', description: 'DEV mode test payload.' },
        ],
    },
];

const ENDPOINT_GROUPS: EndpointGroup[] = [
    {
        category: 'System & Documentation',
        description: 'Service metadata and hosted documentation pages.',
        endpoints: [
            {
                id: 'system-openapi',
                method: 'GET',
                path: '/openapi.json',
                title: 'OpenAPI Schema',
                summary: 'Raw OpenAPI specification for client generation and Postman imports.',
                requiresAuth: false,
                scopes: ['meta.read'],
            },
            {
                id: 'system-swagger',
                method: 'GET',
                path: '/docs',
                title: 'Swagger UI',
                summary: 'Interactive Swagger UI rendered by FastAPI.',
                requiresAuth: false,
                scopes: ['docs.read'],
            },
            {
                id: 'system-swagger-redirect',
                method: 'GET',
                path: '/docs/oauth2-redirect',
                title: 'Swagger OAuth Redirect',
                summary: 'Helper redirect endpoint used during Swagger OAuth authorization.',
                requiresAuth: false,
                scopes: ['docs.read'],
            },
            {
                id: 'system-redoc',
                method: 'GET',
                path: '/redoc',
                title: 'ReDoc Documentation',
                summary: 'Static ReDoc documentation view.',
                requiresAuth: false,
                scopes: ['docs.read'],
            },
            {
                id: 'system-health',
                method: 'GET',
                path: '/health',
                title: 'Health Check',
                summary: 'Simple application liveness probe.',
                requiresAuth: false,
                scopes: ['health.check'],
            },
        ],
    },
    {
        category: 'Authentication',
        description: 'Acquire and maintain access tokens for API clients.',
        endpoints: [
            {
                id: 'auth-register',
                method: 'POST',
                path: '/auth/register',
                title: 'Register Owner/Admin',
                summary: 'Create a new user (owner/admin) account for the workspace.',
                requiresAuth: false,
                scopes: ['auth.register'],
                bodyExample: {
                    name: 'Owner Example',
                    email: 'owner@example.com',
                    password: 'changeme',
                    role: 'owner',
                    status: 'ACTIVE',
                    employer_id: 'EMP-001',
                },
            },
            {
                id: 'auth-login',
                method: 'POST',
                path: '/auth/login',
                title: 'Login',
                summary: 'Authenticate an existing user and retrieve access/refresh tokens.',
                requiresAuth: false,
                scopes: ['auth.login'],
                bodyExample: {
                    email: 'owner@example.com',
                    password: 'changeme',
                },
            },
            {
                id: 'auth-refresh',
                method: 'POST',
                path: '/auth/refresh',
                title: 'Refresh Token',
                summary: 'Exchange a refresh token for a new access token.',
                requiresAuth: false,
                scopes: ['auth.refresh'],
                bodyExample: {
                    refresh_token: 'your-refresh-token',
                },
            },
            {
                id: 'auth-me',
                method: 'GET',
                path: '/auth/me',
                title: 'Current User',
                summary: 'Return the currently authenticated user profile.',
                requiresAuth: true,
                scopes: ['auth.profile.read'],
            },
            {
                id: 'auth-forgot',
                method: 'POST',
                path: '/auth/forgot-password',
                title: 'Forgot Password',
                summary: 'Send a password reset email to the supplied address.',
                requiresAuth: false,
                scopes: ['auth.password.reset'],
                bodyExample: {
                    email: 'owner@example.com',
                },
            },
        ],
    },
    {
        category: 'Ticket Workflow',
        description: 'Ticket status tracking, approvals, tasks, and logs.',
        endpoints: [
            {
                id: 'tickets-get',
                method: 'GET',
                path: '/api/tickets/{id}',
                title: 'Get ticket',
                summary: 'Fetch a ticket with status history, approvals, and tasks.',
                requiresAuth: true,
                scopes: ['tickets.read'],
            },
            {
                id: 'tickets-status',
                method: 'POST',
                path: '/api/tickets/{id}/status',
                title: 'Update ticket status',
                summary: 'Change ticket status and record history.',
                requiresAuth: true,
                scopes: ['tickets.write'],
            },
            {
                id: 'tickets-approvals-request',
                method: 'POST',
                path: '/api/tickets/{id}/approvals/request',
                title: 'Request approval',
                summary: 'Start an approval cycle with per-approver messages.',
                requiresAuth: true,
                scopes: ['approvals.write'],
            },
            {
                id: 'approvals-approve',
                method: 'POST',
                path: '/api/approvals/{cycle_id}/approve',
                title: 'Approve',
                summary: 'Approve a pending approval cycle.',
                requiresAuth: true,
                scopes: ['approvals.write'],
            },
            {
                id: 'approvals-reject',
                method: 'POST',
                path: '/api/approvals/{cycle_id}/reject',
                title: 'Reject',
                summary: 'Reject a pending approval cycle.',
                requiresAuth: true,
                scopes: ['approvals.write'],
            },
            {
                id: 'approvals-pending',
                method: 'GET',
                path: '/api/approvals/pending',
                title: 'Pending approvals',
                summary: 'List approvals pending for the current user.',
                requiresAuth: true,
                scopes: ['approvals.read'],
            },
            {
                id: 'ticket-tasks-list',
                method: 'GET',
                path: '/api/tickets/{id}/tasks',
                title: 'List ticket tasks',
                summary: 'List all tasks linked to a ticket.',
                requiresAuth: true,
                scopes: ['ticket_tasks.read'],
            },
            {
                id: 'ticket-tasks-create',
                method: 'POST',
                path: '/api/tickets/{id}/tasks',
                title: 'Create ticket task',
                summary: 'Create a task linked to a ticket.',
                requiresAuth: true,
                scopes: ['ticket_tasks.write'],
            },
            {
                id: 'ticket-tasks-update',
                method: 'PATCH',
                path: '/api/tasks/{id}',
                title: 'Update ticket task',
                summary: 'Update fields on a ticket task.',
                requiresAuth: true,
                scopes: ['ticket_tasks.write'],
            },
            {
                id: 'ticket-tasks-complete',
                method: 'POST',
                path: '/api/tasks/{id}/complete',
                title: 'Complete ticket task',
                summary: 'Mark a ticket task as completed.',
                requiresAuth: true,
                scopes: ['ticket_tasks.write'],
            },
            {
                id: 'tickets-logs',
                method: 'GET',
                path: '/api/tickets/{id}/logs',
                title: 'Ticket logs',
                summary: 'Fetch paginated audit logs for a ticket.',
                requiresAuth: true,
                scopes: ['tickets.logs.read'],
            },
        ],
    },
    {
        category: 'Users',
        description: 'Manage workspace members and their profile information.',
        endpoints: [
            {
                id: 'users-list',
                method: 'GET',
                path: '/users',
                title: 'List Users',
                summary: 'Retrieve all users visible to the requester.',
                requiresAuth: true,
                scopes: ['users.read'],
            },
            {
                id: 'users-create',
                method: 'POST',
                path: '/users',
                title: 'Create User',
                summary: 'Provision a new user and assign an optional department.',
                requiresAuth: true,
                scopes: ['users.write'],
                bodyExample: {
                    name: 'Team Member',
                    email: 'member@example.com',
                    password: 'securepass',
                    role: 'user',
                    department_id: null,
                },
            },
            {
                id: 'users-read',
                method: 'GET',
                path: '/users/{user_id}',
                title: 'Get User',
                summary: 'Fetch details for a specific user.',
                requiresAuth: true,
                scopes: ['users.read'],
            },
            {
                id: 'users-update',
                method: 'PATCH',
                path: '/users/{user_id}',
                title: 'Update User',
                summary: 'Update role, department, or status for a specific user.',
                requiresAuth: true,
                scopes: ['users.write'],
                bodyExample: {
                    role: 'admin',
                    department_id: 'dept-123',
                    status: 'ACTIVE',
                },
            },
            {
                id: 'users-delete',
                method: 'DELETE',
                path: '/users/{user_id}',
                title: 'Delete User',
                summary: 'Remove a user from the workspace.',
                requiresAuth: true,
                scopes: ['users.delete'],
            },
            {
                id: 'users-me-update',
                method: 'PATCH',
                path: '/users/me',
                title: 'Update My Profile',
                summary: 'Self-service profile update for the current user.',
                requiresAuth: true,
                scopes: ['users.self.update'],
                bodyExample: {
                    name: 'Updated Owner',
                    employer_id: 'EMP-200',
                    department_id: null,
                },
            },
            {
                id: 'users-change-password',
                method: 'POST',
                path: '/users/me/change-password',
                title: 'Change My Password',
                summary: 'Change password for the authenticated user.',
                requiresAuth: true,
                scopes: ['auth.password.change'],
                bodyExample: {
                    old_password: 'currentPass',
                    new_password: 'newStrongPass',
                },
            },
            {
                id: 'users-reset-password',
                method: 'POST',
                path: '/users/{user_id}/reset-password',
                title: 'Reset Password (Admin)',
                summary: 'Set a new password for a user as an administrator.',
                requiresAuth: true,
                scopes: ['users.password.manage'],
                bodyExample: {
                    new_password: 'newStrongPassword',
                },
            },
            {
                id: 'users-by-employer',
                method: 'GET',
                path: '/users/by-employer-id/{employer_id}',
                title: 'Find by Employer ID',
                summary: 'Lookup a user using an external employer identifier.',
                requiresAuth: true,
                scopes: ['users.by_employer.read'],
            },
        ],
    },
    {
        category: 'Departments',
        description: 'Department catalogue CRUD.',
        endpoints: [
            {
                id: 'departments-list',
                method: 'GET',
                path: '/departments',
                title: 'List Departments',
                summary: 'Retrieve all departments.',
                requiresAuth: true,
                scopes: ['departments.read'],
            },
            {
                id: 'departments-create',
                method: 'POST',
                path: '/departments',
                title: 'Create Department',
                summary: 'Create a new department.',
                requiresAuth: true,
                scopes: ['departments.write'],
                bodyExample: {
                    name: 'Customer Success',
                },
            },
            {
                id: 'departments-update',
                method: 'PATCH',
                path: '/departments/{department_id}',
                title: 'Update Department',
                summary: 'Rename an existing department.',
                requiresAuth: true,
                scopes: ['departments.write'],
                bodyExample: {
                    name: 'Product',
                },
            },
            {
                id: 'departments-delete',
                method: 'DELETE',
                path: '/departments/{department_id}',
                title: 'Delete Department',
                summary: 'Remove a department from the workspace.',
                requiresAuth: true,
                scopes: ['departments.delete'],
            },
        ],
    },
    {
        category: 'Kanban Board',
        description: 'Manage columns for the task board.',
        endpoints: [
            {
                id: 'kanban-list',
                method: 'GET',
                path: '/kanban-columns',
                title: 'List Columns',
                summary: 'Fetch configured Kanban columns.',
                requiresAuth: true,
                scopes: ['kanban.read'],
            },
            {
                id: 'kanban-create',
                method: 'POST',
                path: '/kanban-columns',
                title: 'Create Column',
                summary: 'Add a new column to the Kanban board.',
                requiresAuth: true,
                scopes: ['kanban.write'],
                bodyExample: {
                    title: 'In QA',
                    order: 3,
                },
            },
            {
                id: 'kanban-update',
                method: 'PATCH',
                path: '/kanban-columns/{column_id}',
                title: 'Update Column',
                summary: 'Edit column name or order.',
                requiresAuth: true,
                scopes: ['kanban.write'],
                bodyExample: {
                    title: 'Ready to Deploy',
                },
            },
            {
                id: 'kanban-delete',
                method: 'DELETE',
                path: '/kanban-columns/{column_id}',
                title: 'Delete Column',
                summary: 'Remove a column from the board.',
                requiresAuth: true,
                scopes: ['kanban.delete'],
            },
        ],
    },
    {
        category: 'Tasks & Templates',
        description: 'Create, assign, and maintain workload for the team.',
        endpoints: [
            {
                id: 'tasks-list',
                method: 'GET',
                path: '/tasks',
                title: 'List Tasks',
                summary: 'Return tasks visible to the caller (supports assignee_name filter).',
                requiresAuth: true,
                scopes: ['comments.read'],
                queryParams: [
                    {
                        key: 'assignee_name',
                        value: 'Jaffar Siddiq',
                        description: 'Filter tasks by assignee name (partial match).',
                    },
                ],
            },
            {
                id: 'tasks-create',
                method: 'POST',
                path: '/tasks',
                title: 'Create Task',
                summary: 'Create a new task with optional assignments and metadata.',
                requiresAuth: true,
                scopes: ['tasks.delete'],
                bodyExample: {
                    title: 'Finalize Landing Page',
                    description: 'Coordinate assets and QA sign-off.',
                    priority: 'HIGH',
                    status: 'TODO',
                    team: 'Product',
                    assigned_to_ids: ['user-1'],
                    due_at: '2025-01-31T18:00:00Z',
                },
            },
            {
                id: 'tasks-read',
                method: 'GET',
                path: '/tasks/{task_id}',
                title: 'Get Task',
                summary: 'Detailed task view including subtasks and metadata.',
                requiresAuth: true,
                scopes: ['tasks.read'],
            },
            {
                id: 'tasks-update',
                method: 'PATCH',
                path: '/tasks/{task_id}',
                title: 'Update Task',
                summary: 'Modify task fields such as status, priority, or assignments.',
                requiresAuth: true,
                scopes: ['tasks.subtasks.manage'],
                bodyExample: {
                    status: 'IN_PROGRESS',
                    priority: 'MEDIUM',
                },
            },
            {
                id: 'tasks-delete',
                method: 'DELETE',
                path: '/tasks/{task_id}',
                title: 'Delete Task',
                summary: 'Delete a task and associated subtasks/comments.',
                requiresAuth: true,
                scopes: ['tasks.delete'],
            },
            {
                id: 'tasks-subtask-update',
                method: 'PATCH',
                path: '/tasks/{task_id}/subtasks/{subtask_id}',
                title: 'Update Subtask',
                summary: 'Mark a subtask as complete or rename it.',
                requiresAuth: true,
                scopes: ['tasks.subtasks.manage'],
                bodyExample: {
                    completed: true,
                },
            },
            {
                id: 'templates-list',
                method: 'GET',
                path: '/tasks/task-templates',
                title: 'List Task Templates',
                summary: 'Retrieve reusable task templates.',
                requiresAuth: true,
                scopes: ['tasks.templates.read'],
            },
            {
                id: 'templates-create',
                method: 'POST',
                path: '/tasks/task-templates',
                title: 'Create Task Template',
                summary: 'Define a reusable template for recurring work.',
                requiresAuth: true,
                scopes: ['tasks.templates.write'],
                bodyExample: {
                    title: 'Weekly Status Report',
                    description: 'Gather metrics and publish updates.',
                    priority: 'MEDIUM',
                    team: 'Operations',
                    subtasks: ['Collect metrics', 'Draft summary', 'Review with leadership'],
                },
            },
            {
                id: 'templates-read',
                method: 'GET',
                path: '/tasks/task-templates/{template_id}',
                title: 'Get Task Template',
                summary: 'Retrieve template detail.',
                requiresAuth: true,
                scopes: ['tasks.templates.read'],
            },
            {
                id: 'templates-update',
                method: 'PATCH',
                path: '/tasks/task-templates/{template_id}',
                title: 'Update Task Template',
                summary: 'Modify template metadata or content.',
                requiresAuth: true,
                scopes: ['tasks.templates.write'],
            },
            {
                id: 'templates-delete',
                method: 'DELETE',
                path: '/tasks/task-templates/{template_id}',
                title: 'Delete Task Template',
                summary: 'Remove a template that is no longer needed.',
                requiresAuth: true,
                scopes: ['tasks.templates.write'],
            },
            {
                id: 'templates-assign',
                method: 'POST',
                path: '/tasks/task-templates/{template_id}/assign',
                title: 'Assign Template',
                summary: 'Instantiate tasks from a template for users or departments.',
                requiresAuth: true,
                scopes: ['tasks.templates.assign'],
                bodyExample: {
                    assignmentType: 'multiple',
                    userIds: ['user-1', 'user-2'],
                    departmentId: null,
                },
            },
        ],
    },
    {
        category: 'Comments',
        description: 'Threaded collaboration on tasks.',
        endpoints: [
            {
                id: 'comments-list',
                method: 'GET',
                path: '/comments/task/{task_id}',
                title: 'List Comments',
                summary: 'Retrieve comments for a task.',
                requiresAuth: true,
                scopes: ['tasks.read'],
            },
            {
                id: 'comments-create',
                method: 'POST',
                path: '/comments',
                title: 'Add Comment',
                summary: 'Post a new comment on a task.',
                requiresAuth: true,
                scopes: ['comments.write'],
                bodyExample: {
                    task_id: 'task-1',
                    content: 'Please review the latest changes.',
                },
            },
            {
                id: 'comments-delete',
                method: 'DELETE',
                path: '/comments/{comment_id}',
                title: 'Delete Comment',
                summary: 'Remove a comment from a task.',
                requiresAuth: true,
                scopes: ['comments.delete'],
            },
        ],
    },
    {
        category: 'Achievements',
        description: 'Configure badges and achievement definitions.',
        endpoints: [
            {
                id: 'achievements-list',
                method: 'GET',
                path: '/achievements',
                title: 'List Achievements',
                summary: 'Retrieve all available achievements.',
                requiresAuth: true,
                scopes: ['achievements.read'],
            },
            {
                id: 'achievements-create',
                method: 'POST',
                path: '/achievements',
                title: 'Create Achievement',
                summary: 'Add a new achievement definition.',
                requiresAuth: true,
                scopes: ['achievements.write'],
                bodyExample: {
                    name: 'Task Master',
                    description: 'Complete 10 tasks in a week.',
                    points: 100,
                },
            },
            {
                id: 'achievements-update',
                method: 'PATCH',
                path: '/achievements/{achievement_id}',
                title: 'Update Achievement',
                summary: 'Modify achievement metadata.',
                requiresAuth: true,
                scopes: ['achievements.write'],
            },
            {
                id: 'achievements-delete',
                method: 'DELETE',
                path: '/achievements/{achievement_id}',
                title: 'Delete Achievement',
                summary: 'Remove an achievement definition.',
                requiresAuth: true,
                scopes: ['achievements.delete'],
            },
        ],
    },
    {
        category: 'Rewards',
        description: 'Reward catalogue operations and claims.',
        endpoints: [
            {
                id: 'rewards-list',
                method: 'GET',
                path: '/rewards',
                title: 'List Rewards',
                summary: 'Retrieve reward catalogue items.',
                requiresAuth: true,
                scopes: ['rewards.read'],
            },
            {
                id: 'rewards-create',
                method: 'POST',
                path: '/rewards',
                title: 'Create Reward',
                summary: 'Add a new reward to the catalogue.',
                requiresAuth: true,
                scopes: ['rewards.write'],
                bodyExample: {
                    title: 'Amazon Voucher $25',
                    description: 'Digital voucher redeemable at Amazon.',
                    points_required: 500,
                    value: '25',
                },
            },
            {
                id: 'rewards-read',
                method: 'GET',
                path: '/rewards/{reward_id}',
                title: 'Get Reward',
                summary: 'Inspect details of a reward.',
                requiresAuth: true,
                scopes: ['rewards.read'],
            },
            {
                id: 'rewards-update',
                method: 'PATCH',
                path: '/rewards/{reward_id}',
                title: 'Update Reward',
                summary: 'Adjust reward metadata or redemption rules.',
                requiresAuth: true,
                scopes: ['rewards.write'],
            },
            {
                id: 'rewards-delete',
                method: 'DELETE',
                path: '/rewards/{reward_id}',
                title: 'Delete Reward',
                summary: 'Remove a reward from the catalogue.',
                requiresAuth: true,
                scopes: ['rewards.delete'],
            },
            {
                id: 'rewards-claim',
                method: 'POST',
                path: '/rewards/{reward_id}/claim',
                title: 'Claim Reward',
                summary: 'Submit a claim for a reward on behalf of a user.',
                requiresAuth: true,
                scopes: ['rewards.claim'],
                bodyExample: {
                    user_id: 'user-1',
                },
            },
        ],
    },
    {
        category: 'Notifications',
        description: 'Inbox operations for in-app notifications.',
        endpoints: [
            {
                id: 'notifications-list',
                method: 'GET',
                path: '/notifications',
                title: 'List Notifications',
                summary: 'Retrieve notifications for the current user.',
                requiresAuth: true,
                scopes: ['notifications.read'],
            },
            {
                id: 'notifications-read-all',
                method: 'POST',
                path: '/notifications/read-all',
                title: 'Mark All Read',
                summary: 'Mark every notification as read.',
                requiresAuth: true,
                scopes: ['notifications.write'],
            },
            {
                id: 'notifications-read-one',
                method: 'POST',
                path: '/notifications/{notification_id}/read',
                title: 'Mark One Read',
                summary: 'Mark a specific notification as read.',
                requiresAuth: true,
                scopes: ['notifications.write'],
            },
        ],
    },
    {
        category: 'Configuration',
        description: 'Programmatically manage SMTP, API config, OAuth, and n8n integrations.',
        endpoints: [
            {
                id: 'config-smtp-get',
                method: 'GET',
                path: '/config/smtp',
                title: 'Get SMTP Config',
                summary: 'Retrieve the primary SMTP configuration used for transactional emails.',
                requiresAuth: true,
                scopes: ['config.smtp.read'],
            },
            {
                id: 'config-smtp-update',
                method: 'PATCH',
                path: '/config/smtp',
                title: 'Update SMTP Config',
                summary: 'Update the default SMTP host, port, and credentials.',
                requiresAuth: true,
                scopes: ['config.smtp.write'],
                bodyExample: {
                    host: 'smtp.example.com',
                    port: 587,
                    username: 'noreply@example.com',
                    encryption: 'tls',
                },
            },
            {
                id: 'config-api-get',
                method: 'GET',
                path: '/config/api',
                title: 'Get API Provider Config',
                summary: 'Retrieve the configured AI provider and API key.',
                requiresAuth: true,
                scopes: ['config.api.read'],
            },
            {
                id: 'config-api-update',
                method: 'PATCH',
                path: '/config/api',
                title: 'Update API Provider Config',
                summary: 'Set the AI provider and API key for connected services.',
                requiresAuth: true,
                scopes: ['config.api.write'],
                bodyExample: {
                    provider: 'Google Gemini',
                    api_key: 'sk-example',
                },
            },
            {
                id: 'config-smtp-multi-list',
                method: 'GET',
                path: '/config/smtp/multiple',
                title: 'List SMTP Profiles',
                summary: 'Return all named SMTP profiles used for routing notifications.',
                requiresAuth: true,
                scopes: ['config.smtp.multiple'],
            },
            {
                id: 'config-smtp-multi-create',
                method: 'POST',
                path: '/config/smtp/multiple',
                title: 'Create SMTP Profile',
                summary: 'Create a named SMTP profile for specific notification types.',
                requiresAuth: true,
                scopes: ['config.smtp.multiple'],
                bodyExample: {
                    name: 'Task Alerts Mailbox',
                    host: 'smtp.example.com',
                    port: 587,
                    username: 'alerts@example.com',
                    password: 'app-specific-password',
                    encryption: 'tls',
                    notification_types: ['task_notifications', 'system_alerts', 'support_notifications'],
                },
            },
            {
                id: 'config-smtp-multi-update',
                method: 'PATCH',
                path: '/config/smtp/multiple/{config_id}',
                title: 'Update SMTP Profile',
                summary: 'Update host, credentials, or mapped notification types for a named profile.',
                requiresAuth: true,
                scopes: ['config.smtp.multiple'],
            },
            {
                id: 'config-smtp-multi-delete',
                method: 'DELETE',
                path: '/config/smtp/multiple/{config_id}',
                title: 'Delete SMTP Profile',
                summary: 'Remove a named SMTP profile.',
                requiresAuth: true,
                scopes: ['config.smtp.multiple'],
            },
            {
                id: 'config-smtp-multi-test',
                method: 'POST',
                path: '/config/smtp/multiple/{config_id}/test',
                title: 'Send SMTP Test Email',
                summary: 'Send a test email using the selected SMTP profile.',
                requiresAuth: true,
                scopes: ['config.smtp.multiple'],
                bodyExample: {
                    notification_type: 'welcome_password',
                    to_address: 'owner@example.com',
                    subject: 'SMTP test',
                    body: 'This is a test email from Zea Play.',
                },
            },
            {
                id: 'config-email-templates-list',
                method: 'GET',
                path: '/config/email-templates',
                title: 'List Email Templates',
                summary: 'Return the subject/body templates for each notification type.',
                requiresAuth: true,
                scopes: ['config.email.templates'],
            },
            {
                id: 'config-email-templates-update',
                method: 'PUT',
                path: '/config/email-templates/{notification_type}',
                title: 'Update Email Template',
                summary: 'Create or update an email template for a notification type.',
                requiresAuth: true,
                scopes: ['config.email.templates'],
                bodyExample: {
                    subject: 'Welcome to Zea Play',
                    body: 'Hello {{name}}, welcome to Zea Play!',
                },
            },
            {
                id: 'config-oauth-list',
                method: 'GET',
                path: '/config/oauth',
                title: 'List OAuth Clients',
                summary: 'Return all registered OAuth applications and credentials.',
                requiresAuth: true,
                scopes: ['config.oauth.manage'],
            },
            {
                id: 'config-oauth-create',
                method: 'POST',
                path: '/config/oauth',
                title: 'Create OAuth Client',
                summary: 'Create an OAuth client with optional custom credentials.',
                requiresAuth: true,
                scopes: ['config.oauth.manage'],
                bodyExample: {
                    name: 'n8n automation',
                    redirect_url: 'https://n8n.example.com/oauth/callback',
                    scopes: ['tasks.read', 'tasks.write', 'integrations.n8n.trigger'],
                    n8n_integration: true,
                },
            },
            {
                id: 'config-oauth-update',
                method: 'PATCH',
                path: '/config/oauth/{config_id}',
                title: 'Update OAuth Client',
                summary: 'Edit OAuth client metadata or allowed scopes.',
                requiresAuth: true,
                scopes: ['config.oauth.manage'],
            },
            {
                id: 'config-oauth-rotate',
                method: 'POST',
                path: '/config/oauth/{config_id}/rotate',
                title: 'Rotate OAuth Credentials',
                summary: 'Regenerate client ID, secret, or API key.',
                requiresAuth: true,
                scopes: ['config.oauth.manage'],
                bodyExample: {
                    rotate_client_secret: true,
                    rotate_api_key: true,
                },
            },
            {
                id: 'config-oauth-delete',
                method: 'DELETE',
                path: '/config/oauth/{config_id}',
                title: 'Delete OAuth Client',
                summary: 'Remove an OAuth client and revoke its credentials.',
                requiresAuth: true,
                scopes: ['config.oauth.manage'],
            },
        ],
    },
    {
        category: 'Integrations (n8n)',
        description: 'Trigger automation workflows via n8n.',
        endpoints: [
            {
                id: 'n8n-config',
                method: 'GET',
                path: '/integrations/n8n/config',
                title: 'Get n8n Config',
                summary: 'Return current n8n forwarding configuration.',
                requiresAuth: true,
                scopes: ['integrations.n8n.read'],
            },
            {
                id: 'n8n-trigger',
                method: 'POST',
                path: '/integrations/n8n/trigger',
                title: 'Trigger Custom Event',
                summary: 'Send a custom event payload to n8n.',
                requiresAuth: true,
                scopes: ['integrations.n8n.trigger'],
                bodyExample: {
                    event: 'task.created',
                    payload: {
                        taskId: 'task-1',
                        title: 'Finalize Landing Page',
                    },
                },
            },
            {
                id: 'n8n-test',
                method: 'POST',
                path: '/integrations/n8n/test',
                title: 'Send Test Event',
                summary: 'Send a test webhook event to verify n8n connectivity.',
                requiresAuth: true,
                scopes: ['integrations.n8n.test'],
            },
        ],
    },
    {
        category: 'Data Administration',
        description: 'Workspace export, import, and destructive reset tools.',
        endpoints: [
            {
                id: 'data-export',
                method: 'GET',
                path: '/admin/data/export',
                title: 'Export Data',
                summary: 'Download a JSON backup. Supports scope=all|users|tasks.',
                requiresAuth: true,
                scopes: ['admin.data.export'],
                queryParams: [{ key: 'scope', value: 'all', description: 'all | users | tasks' }],
            },
            {
                id: 'data-import',
                method: 'POST',
                path: '/admin/data/import',
                title: 'Import Data',
                summary: 'Restore a JSON backup exported from the system.',
                requiresAuth: true,
                scopes: ['admin.data.import'],
                bodyExample: {
                    scope: 'all',
                    users: [],
                    tasks: [],
                },
            },
            {
                id: 'data-reset-request',
                method: 'POST',
                path: '/admin/data/reset/request',
                title: 'Request Reset OTP',
                summary: 'Send an OTP to the owner email to confirm a full reset.',
                requiresAuth: true,
                scopes: ['admin.data.reset'],
            },
            {
                id: 'data-reset-confirm',
                method: 'POST',
                path: '/admin/data/reset/confirm',
                title: 'Confirm Workspace Reset',
                summary: 'Submit the OTP to wipe non-essential data and reseed.',
                requiresAuth: true,
                scopes: ['admin.data.reset'],
                bodyExample: {
                    otp: '123456',
                },
            },
        ],
    },
    {
        category: 'OAuth 2.0',
        description: 'Standard OAuth token issuance for third-party clients.',
        endpoints: [
            {
                id: 'oauth-token',
                method: 'POST',
                path: '/oauth2/token',
                title: 'Token Endpoint',
                summary: 'Issue access tokens using OAuth grant types (authorization_code, refresh_token).',
                requiresAuth: false,
                scopes: ['oauth.tokens.issue'],
                headers: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
                bodyExample: {
                    grant_type: 'authorization_code',
                    client_id: '{{client_id}}',
                    client_secret: '{{client_secret}}',
                    code: '{{auth_code}}',
                    redirect_uri: 'https://app.example.com/oauth/callback',
                },
            },
        ],
    },
];

const SCOPE_MATRIX: Array<{ category: string; scopes: Array<{ id: string; description: string }> }> = [
    {
        category: 'Authentication & Identity',
        scopes: [
            { id: 'auth.register', description: 'Register new user accounts' },
            { id: 'auth.login', description: 'Obtain authentication token' },
            { id: 'auth.refresh', description: 'Refresh access tokens' },
            { id: 'auth.profile.read', description: 'View authenticated user info' },
            { id: 'auth.password.reset', description: 'Initiate password reset' },
            { id: 'auth.password.change', description: 'Change own password' },
            { id: 'auth.full_access', description: 'Full access to all authentication endpoints' },
        ],
    },
    {
        category: 'Users',
        scopes: [
            { id: 'users.read', description: 'Read all users' },
            { id: 'users.write', description: 'Create or update user records' },
            { id: 'users.delete', description: 'Delete users' },
            { id: 'users.self.update', description: 'Update current user profile' },
            { id: 'users.password.manage', description: 'Reset or change passwords for others' },
            { id: 'users.by_employer.read', description: 'Fetch users by employer ID' },
            { id: 'users.full_access', description: 'Complete access to all user endpoints' },
        ],
    },
    {
        category: 'Departments',
        scopes: [
            { id: 'departments.read', description: 'View department list' },
            { id: 'departments.write', description: 'Create or update departments' },
            { id: 'departments.delete', description: 'Delete departments' },
            { id: 'departments.full_access', description: 'All department operations' },
        ],
    },
    {
        category: 'Kanban Columns',
        scopes: [
            { id: 'kanban.read', description: 'View Kanban columns' },
            { id: 'kanban.write', description: 'Create or update columns' },
            { id: 'kanban.delete', description: 'Delete columns' },
            { id: 'kanban.full_access', description: 'All Kanban operations' },
        ],
    },
    {
        category: 'Tasks & Subtasks',
        scopes: [
            { id: 'tasks.read', description: 'View all tasks' },
            { id: 'tasks.write', description: 'Create or update tasks' },
            { id: 'tasks.delete', description: 'Delete tasks' },
            { id: 'tasks.subtasks.manage', description: 'Manage subtasks' },
            { id: 'tasks.templates.read', description: 'Read task templates' },
            { id: 'tasks.templates.write', description: 'Create or edit task templates' },
            { id: 'tasks.templates.assign', description: 'Assign templates' },
            { id: 'tasks.full_access', description: 'Full access to all task endpoints' },
        ],
    },
    {
        category: 'Tickets',
        scopes: [
            { id: 'tickets.read', description: 'View ticket data' },
            { id: 'tickets.write', description: 'Create or update tickets' },
            { id: 'tickets.logs.read', description: 'Read ticket audit logs' },
            { id: 'approvals.read', description: 'View approval queues' },
            { id: 'approvals.write', description: 'Submit approval decisions' },
            { id: 'ticket_tasks.read', description: 'View ticket-linked tasks' },
            { id: 'ticket_tasks.write', description: 'Create or update ticket-linked tasks' },
        ],
    },
    {
        category: 'Comments',
        scopes: [
            { id: 'comments.read', description: 'View comments under a task' },
            { id: 'comments.write', description: 'Post comments' },
            { id: 'comments.delete', description: 'Delete comments' },
            { id: 'comments.full_access', description: 'Full access to comment endpoints' },
        ],
    },
    {
        category: 'Achievements',
        scopes: [
            { id: 'achievements.read', description: 'Read achievements' },
            { id: 'achievements.write', description: 'Create or edit achievements' },
            { id: 'achievements.delete', description: 'Delete achievements' },
            { id: 'achievements.full_access', description: 'All achievement operations' },
        ],
    },
    {
        category: 'Rewards',
        scopes: [
            { id: 'rewards.read', description: 'View rewards list' },
            { id: 'rewards.write', description: 'Create or edit rewards' },
            { id: 'rewards.delete', description: 'Delete rewards' },
            { id: 'rewards.claim', description: 'Claim rewards for a user' },
            { id: 'rewards.full_access', description: 'All reward operations' },
        ],
    },
    {
        category: 'Notifications',
        scopes: [
            { id: 'notifications.read', description: 'View notifications' },
            { id: 'notifications.write', description: 'Mark notifications as read' },
            { id: 'notifications.full_access', description: 'Full access to notifications API' },
        ],
    },
    {
        category: 'Configuration & System',
        scopes: [
            { id: 'config.smtp.read', description: 'Read SMTP config' },
            { id: 'config.smtp.write', description: 'Update SMTP config' },
            { id: 'config.smtp.multiple', description: 'Manage multiple SMTP entries' },
            { id: 'config.email.templates', description: 'Manage email templates' },
            { id: 'config.api.read', description: 'View API config' },
            { id: 'config.api.write', description: 'Update API config' },
            { id: 'config.oauth.manage', description: 'Manage OAuth clients (rotate, delete)' },
            { id: 'config.full_access', description: 'Complete configuration access' },
        ],
    },
    {
        category: 'Integrations',
        scopes: [
            { id: 'integrations.n8n.read', description: 'View n8n integration config' },
            { id: 'integrations.n8n.trigger', description: 'Trigger n8n workflows' },
            { id: 'integrations.n8n.test', description: 'Run n8n test connection' },
            { id: 'integrations.full_access', description: 'Manage all integrations' },
        ],
    },
    {
        category: 'Admin & Data Operations',
        scopes: [
            { id: 'admin.data.export', description: 'Export data' },
            { id: 'admin.data.import', description: 'Import data' },
            { id: 'admin.data.reset', description: 'Request or confirm data reset' },
            { id: 'admin.full_access', description: 'All administrative actions' },
        ],
    },
    {
        category: 'OAuth & Developer Console',
        scopes: [
            { id: 'oauth.apps.read', description: 'View registered apps' },
            { id: 'oauth.apps.write', description: 'Register or edit OAuth apps' },
            { id: 'oauth.apps.delete', description: 'Delete or revoke OAuth apps' },
            { id: 'oauth.tokens.issue', description: 'Generate or refresh OAuth tokens' },
            { id: 'oauth.tokens.revoke', description: 'Revoke tokens' },
            { id: 'oauth.full_access', description: 'Full OAuth and API key management' },
        ],
    },
    {
        category: 'Health & Docs',
        scopes: [
            { id: 'docs.read', description: 'Access API docs and OpenAPI schema' },
            { id: 'health.check', description: 'Check API health status' },
            { id: 'meta.read', description: 'Access meta endpoints like /openapi.json' },
        ],
    },
    {
        category: 'Composite Scopes',
        scopes: [
            { id: 'read.all', description: 'Read-only access to all data' },
            { id: 'write.all', description: 'Write access to all major modules' },
            { id: 'admin.all', description: 'Full system admin access' },
        ],
    },
];

const STATIC_SCOPE_ENTRIES: ScopeCatalogEntry[] = SCOPE_MATRIX.flatMap((group) =>
    group.scopes.map((scope) => ({
        id: scope.id,
        description: scope.description,
        category: group.category,
    })),
);

const ENDPOINT_SCOPE_ENTRIES: ScopeCatalogEntry[] = Array.from(
    new Set(
        ENDPOINT_GROUPS.flatMap((group) =>
            group.endpoints.flatMap((endpoint) => endpoint.scopes ?? []),
        ),
    ),
).map((scopeId) => ({
    id: scopeId,
    description: '',
    category: 'Endpoint-derived',
}));

const scopeMap = new Map<string, ScopeCatalogEntry>();
ENDPOINT_SCOPE_ENTRIES.forEach((entry) => scopeMap.set(entry.id, entry));
STATIC_SCOPE_ENTRIES.forEach((entry) => scopeMap.set(entry.id, entry));

const ALL_SCOPES: ScopeCatalogEntry[] = Array.from(scopeMap.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
);

const SCOPE_LOOKUP = new Map(ALL_SCOPES.map((entry) => [entry.id, entry] as const));

const SCOPE_OPTIONS = ALL_SCOPES.map((scope) => ({
    id: scope.id,
    name: scope.description ? `${scope.id} - ${scope.description}` : scope.id,
}));

const DEFAULT_SCOPE_SELECTION = ALL_SCOPES.slice(0, 2).map((scope) => scope.id);
const LONG_LIVED_MINUTES = 60 * 24 * 365 * 10;
const EXPIRY_PRESETS = [
    { id: '1d', label: '1 day', minutes: 60 * 24 },
    { id: '1w', label: '1 week', minutes: 60 * 24 * 7 },
    { id: '1m', label: '1 month', minutes: 60 * 24 * 30 },
    { id: '1y', label: '1 year', minutes: 60 * 24 * 365 },
    { id: 'never', label: 'Never expire (10 years)', minutes: LONG_LIVED_MINUTES },
    { id: 'custom', label: 'Custom date/time', minutes: null },
];

const scopeLabel = (scopeId: string): string => {
    const entry = SCOPE_LOOKUP.get(scopeId);
    if (!entry) {
        return scopeId;
    }
    return entry.description ? `${scopeId} — ${entry.description}` : scopeId;
};

const ApiOverview: React.FC = () => {
    const [stats, setStats] = useState({
        totalApps: 0,
        totalKeys: 0,
        totalCalls: 0,
        activeKeys: 0,
    });
    const [activeTab, setActiveTab] = useState<
        'overview' | 'documentation' | 'token' | 'smtp' | 'oauth' | 'webhooks'
    >('overview');

    const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'https://playapi.zeacrm.com/';
    const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
    const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDoc>(ENDPOINT_GROUPS[0].endpoints[0]);
    const [tokenName, setTokenName] = useState('My Integration');
    const [selectedScopes, setSelectedScopes] = useState<string[]>(DEFAULT_SCOPE_SELECTION);
    const [generatedKey, setGeneratedKey] = useState('');
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);
    const [expiryPresetId, setExpiryPresetId] = useState('1d');
    const [customExpiryAt, setCustomExpiryAt] = useState('');
    const [customExpiryMinutes, setCustomExpiryMinutes] = useState<number | ''>('');
    const [showAdvancedExpiry, setShowAdvancedExpiry] = useState(false);
    const [expiryError, setExpiryError] = useState<string | null>(null);
    const [hasHydratedFromHistory, setHasHydratedFromHistory] = useState(false);
    const [keyHistory, setKeyHistory] = useState<GeneratedKeyRecord[]>(() => {
        if (typeof window === 'undefined') {
            return [];
        }
        try {
            const stored = window.localStorage.getItem(KEY_HISTORY_STORAGE_KEY);
            if (!stored) {
                return [];
            }
            const parsed = JSON.parse(stored) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter(
                    (item): item is Record<string, unknown> =>
                        typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.key === 'string',
                )
                .map((item) => ({
                    id: item.id as string,
                    label:
                        typeof item.label === 'string' && item.label.trim().length > 0 ? (item.label as string) : 'Saved integration key',
                    key: item.key as string,
                    scopes: Array.isArray(item.scopes)
                        ? item.scopes.filter((scope): scope is string => typeof scope === 'string')
                        : [],
                    baseUrl:
                        typeof item.baseUrl === 'string' && (item.baseUrl as string).trim().length > 0
                            ? (item.baseUrl as string)
                            : defaultBaseUrl,
                    createdAt:
                        typeof item.createdAt === 'string' && item.createdAt ? (item.createdAt as string) : new Date().toISOString(),
                    expiresAt: typeof item.expiresAt === 'string' && item.expiresAt ? (item.expiresAt as string) : undefined,
                    subject: typeof item.subject === 'string' && item.subject ? (item.subject as string) : undefined,
                }));
        } catch (error) {
            console.warn('Failed to parse stored bearer keys', error);
            return [];
        }
    });
    const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
    const [webhooks, setWebhooks] = useState<WebhookSubscription[]>([]);
    const [isLoadingWebhooks, setIsLoadingWebhooks] = useState(false);
    const [webhookError, setWebhookError] = useState<string | null>(null);
    const [activeWebhookId, setActiveWebhookId] = useState<string | null>(null);
    const [webhookDraft, setWebhookDraft] = useState<WebhookDraft>(buildEmptyWebhookDraft);
    const [isSavingWebhook, setIsSavingWebhook] = useState(false);
    const [isTestingWebhook, setIsTestingWebhook] = useState(false);
    const [testEventName, setTestEventName] = useState('');
    const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);
    const handleSelectAllScopes = () => setSelectedScopes(ALL_SCOPES.map((scope) => scope.id));
    const handleClearScopes = () => setSelectedScopes([]);

    const webhookEventGroups = useMemo(() => {
        if (IS_DEV_MODE) {
            return WEBHOOK_EVENT_GROUPS;
        }
        return WEBHOOK_EVENT_GROUPS.filter((group) => group.id !== 'dev');
    }, []);
    const allWebhookEvents = useMemo(
        () => webhookEventGroups.flatMap((group) => group.events),
        [webhookEventGroups],
    );
    const webhookEventLabelMap = useMemo(
        () => new Map(allWebhookEvents.map((event) => [event.id, event.label])),
        [allWebhookEvents],
    );
    const buildWebhookDraftFrom = (webhook: WebhookSubscription): WebhookDraft => {
        const headerEntries = Object.entries(webhook.customHeaders ?? {});
        return {
            id: webhook.id,
            name: webhook.name,
            urls: [webhook.url],
            subscribedEvents: [...webhook.subscribedEvents],
            isEnabled: webhook.isEnabled,
            customHeaders: headerEntries.length
                ? headerEntries.map(([key, value]) => ({ id: createLocalId(), key, value }))
                : [{ id: createLocalId(), key: '', value: '' }],
        };
    };

    const expiryPreviewLabel = useMemo(() => {
        const preset = EXPIRY_PRESETS.find((item) => item.id === expiryPresetId);
        if (!preset) {
            return '';
        }
        if (preset.id === 'custom') {
            if (typeof customExpiryMinutes === 'number' && customExpiryMinutes > 0) {
                const date = new Date(Date.now() + customExpiryMinutes * 60000);
                return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
            }
            if (!customExpiryAt) {
                return '';
            }
            const target = new Date(customExpiryAt);
            return Number.isNaN(target.getTime()) ? '' : target.toLocaleString();
        }
        if (preset.minutes) {
            const date = new Date(Date.now() + preset.minutes * 60000);
            return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
        }
        return '';
    }, [customExpiryAt, customExpiryMinutes, expiryPresetId]);

    useEffect(() => {
        setStats({
            totalApps: 3,
            totalKeys: 12,
            totalCalls: 15420,
            activeKeys: 8,
        });
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        window.localStorage.setItem(KEY_HISTORY_STORAGE_KEY, JSON.stringify(keyHistory));
    }, [keyHistory]);

    useEffect(() => {
        if (!hasHydratedFromHistory && keyHistory.length > 0) {
            const firstRecord = keyHistory[0];
            setGeneratedKey(firstRecord.key);
            setActiveKeyId(firstRecord.id);
            setTokenName(firstRecord.label);
            setSelectedScopes(firstRecord.scopes);
            setBaseUrl(firstRecord.baseUrl);
            setHasHydratedFromHistory(true);
        }
    }, [keyHistory, hasHydratedFromHistory]);

    const refreshWebhooks = async () => {
        setIsLoadingWebhooks(true);
        setWebhookError(null);
        try {
            const list = await api.listWebhooks();
            setWebhooks(list);
            return list;
        } catch (error) {
            if (error instanceof Error) {
                setWebhookError(error.message);
            } else {
                setWebhookError('Unable to load webhooks.');
            }
            return [];
        } finally {
            setIsLoadingWebhooks(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'webhooks') {
            return;
        }
        refreshWebhooks();
    }, [activeTab]);

    const handleSelectWebhook = (webhook: WebhookSubscription) => {
        setActiveWebhookId(webhook.id);
        setWebhookDraft(buildWebhookDraftFrom(webhook));
        setTestEventName(webhook.subscribedEvents[0] ?? '');
        setTestResult(null);
    };

    const handleNewWebhook = () => {
        setActiveWebhookId(null);
        setWebhookDraft(buildEmptyWebhookDraft());
        setTestEventName('');
        setTestResult(null);
    };

    const handleToggleWebhookEvent = (eventId: string) => {
        setWebhookDraft((prev) => {
            const exists = prev.subscribedEvents.includes(eventId);
            return {
                ...prev,
                subscribedEvents: exists
                    ? prev.subscribedEvents.filter((id) => id !== eventId)
                    : [...prev.subscribedEvents, eventId],
            };
        });
    };

    const handleWebhookUrlChange = (index: number, value: string) => {
        setWebhookDraft((prev) => {
            const nextUrls = [...prev.urls];
            nextUrls[index] = value;
            return { ...prev, urls: nextUrls };
        });
    };

    const handleAddWebhookUrl = () => {
        setWebhookDraft((prev) => ({ ...prev, urls: [...prev.urls, ''] }));
    };

    const handleRemoveWebhookUrl = (index: number) => {
        setWebhookDraft((prev) => {
            const nextUrls = prev.urls.filter((_value, idx) => idx !== index);
            return { ...prev, urls: nextUrls.length ? nextUrls : [''] };
        });
    };

    const handleHeaderChange = (id: string, key: 'key' | 'value', value: string) => {
        setWebhookDraft((prev) => ({
            ...prev,
            customHeaders: prev.customHeaders.map((entry) =>
                entry.id === id ? { ...entry, [key]: value } : entry,
            ),
        }));
    };

    const handleAddHeader = () => {
        setWebhookDraft((prev) => ({
            ...prev,
            customHeaders: [...prev.customHeaders, { id: createLocalId(), key: '', value: '' }],
        }));
    };

    const handleRemoveHeader = (id: string) => {
        setWebhookDraft((prev) => {
            const remaining = prev.customHeaders.filter((entry) => entry.id !== id);
            return {
                ...prev,
                customHeaders: remaining.length ? remaining : [{ id: createLocalId(), key: '', value: '' }],
            };
        });
    };

    const handleSaveWebhook = async () => {
        const trimmedName = webhookDraft.name.trim();
        const trimmedEvents = webhookDraft.subscribedEvents.filter((event) => event.trim().length > 0);
        const normalizedUrls = webhookDraft.urls.map((url) => url.trim()).filter((url) => url.length > 0);
        const normalizedHeaders = webhookDraft.customHeaders
            .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
            .filter((header) => header.key && header.value)
            .reduce<Record<string, string>>((acc, header) => {
                acc[header.key] = header.value;
                return acc;
            }, {});

        if (!trimmedName) {
            setWebhookError('Webhook name is required.');
            return;
        }
        if (normalizedUrls.length === 0) {
            setWebhookError('Add at least one webhook URL.');
            return;
        }
        if (trimmedEvents.length === 0) {
            setWebhookError('Select at least one event.');
            return;
        }

        setWebhookError(null);
        setIsSavingWebhook(true);
        try {
            const basePayload = {
                name: trimmedName,
                subscribedEvents: trimmedEvents,
                isEnabled: webhookDraft.isEnabled,
                customHeaders: Object.keys(normalizedHeaders).length ? normalizedHeaders : null,
            };

            const savedWebhooks: WebhookSubscription[] = [];
            if (webhookDraft.id) {
                const updated = await api.updateWebhook(webhookDraft.id, {
                    ...basePayload,
                    url: normalizedUrls[0],
                });
                savedWebhooks.push(updated);

                const extraUrls = normalizedUrls.slice(1);
                if (extraUrls.length > 0) {
                    const extraCreates = await Promise.all(
                        extraUrls.map((url, index) =>
                            api.createWebhook({
                                ...basePayload,
                                name: normalizedUrls.length > 1 ? `${trimmedName} (${index + 2})` : trimmedName,
                                url,
                            }),
                        ),
                    );
                    savedWebhooks.push(...extraCreates);
                }
            } else {
                const created = await Promise.all(
                    normalizedUrls.map((url, index) =>
                        api.createWebhook({
                            ...basePayload,
                            name: normalizedUrls.length > 1 ? `${trimmedName} (${index + 1})` : trimmedName,
                            url,
                        }),
                    ),
                );
                savedWebhooks.push(...created);
            }

            const updatedList = await refreshWebhooks();
            const primary = savedWebhooks[0];
            if (primary) {
                const refreshed = updatedList.find((item) => item.id === primary.id);
                if (refreshed) {
                    handleSelectWebhook(refreshed);
                } else {
                    handleNewWebhook();
                }
            } else {
                handleNewWebhook();
            }
        } catch (error) {
            if (error instanceof Error) {
                setWebhookError(error.message);
            } else {
                setWebhookError('Unable to save webhook.');
            }
        } finally {
            setIsSavingWebhook(false);
        }
    };

    const handleDeleteWebhook = async (webhookId: string) => {
        setWebhookError(null);
        try {
            await api.deleteWebhook(webhookId);
            const updated = await refreshWebhooks();
            if (activeWebhookId === webhookId) {
                const next = updated[0];
                if (next) {
                    handleSelectWebhook(next);
                } else {
                    handleNewWebhook();
                }
            }
        } catch (error) {
            if (error instanceof Error) {
                setWebhookError(error.message);
            } else {
                setWebhookError('Unable to delete webhook.');
            }
        }
    };

    const handleToggleWebhookEnabled = async (webhook: WebhookSubscription) => {
        try {
            const updated = await api.updateWebhook(webhook.id, { isEnabled: !webhook.isEnabled });
            setWebhooks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            if (activeWebhookId === updated.id) {
                setWebhookDraft((prev) => ({ ...prev, isEnabled: updated.isEnabled }));
            }
        } catch (error) {
            if (error instanceof Error) {
                setWebhookError(error.message);
            } else {
                setWebhookError('Unable to update webhook.');
            }
        }
    };

    const handleTestWebhook = async () => {
        if (!webhookDraft.id) {
            return;
        }
        setIsTestingWebhook(true);
        setTestResult(null);
        try {
            const result = await api.testWebhook(webhookDraft.id, testEventName || undefined);
            setTestResult(result);
        } catch (error) {
            if (error instanceof Error) {
                setWebhookError(error.message);
            } else {
                setWebhookError('Unable to test webhook.');
            }
        } finally {
            setIsTestingWebhook(false);
        }
    };

    useEffect(() => {
        if (webhookDraft.subscribedEvents.length === 0) {
            setTestEventName('');
            return;
        }
        if (!testEventName || !webhookDraft.subscribedEvents.includes(testEventName)) {
            setTestEventName(webhookDraft.subscribedEvents[0]);
        }
    }, [testEventName, webhookDraft.subscribedEvents]);

    const postmanSnippet = useMemo(() => {
        const sanitizedBaseUrl = baseUrl.replace(/\/$/, '');
        const authHeaders = selectedEndpoint.requiresAuth
            ? [
                  {
                      key: 'Authorization',
                      value: 'Bearer {{access_token}}',
                      description: 'Provide a valid bearer token for secured routes.',
                  },
              ]
            : [];
        const headers = [...authHeaders, ...(selectedEndpoint.headers ?? [])];
        const hasBody = selectedEndpoint.bodyExample && Object.keys(selectedEndpoint.bodyExample).length > 0;

        const queryEntries = (selectedEndpoint.queryParams ?? []).map((entry) => ({
            key: entry.key,
            value: entry.value ?? `{{${entry.key}}}`,
            description: entry.description ?? '',
        }));
        const queryString =
            queryEntries.length > 0 ? queryEntries.map((entry) => `${entry.key}=${entry.value}`).join('&') : '';
        const rawUrl = queryString
            ? `${sanitizedBaseUrl}${selectedEndpoint.path}?${queryString}`
            : `${sanitizedBaseUrl}${selectedEndpoint.path}`;

        let host = '';
        let basePathSegments: string[] = [];
        try {
            const url = new URL(sanitizedBaseUrl);
            host = url.host;
            basePathSegments = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
        } catch {
            const withoutProtocol = sanitizedBaseUrl.replace(/^https?:\/\//, '');
            const parts = withoutProtocol.split('/');
            host = parts.shift() ?? '';
            basePathSegments = parts.filter(Boolean);
        }

        const endpointPathSegments = selectedEndpoint.path.replace(/^\//, '').split('/').filter(Boolean);
        const pathSegments = [...basePathSegments, ...endpointPathSegments];

        return {
            info: {
                name: selectedEndpoint.title,
                schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
            },
            item: [
                {
                    name: selectedEndpoint.title,
                    request: {
                        method: selectedEndpoint.method,
                        header: headers.map((item) => ({
                            key: item.key,
                            value: item.value,
                            description: item.description ?? '',
                        })),
                        url: {
                            raw: rawUrl,
                            host: [host || sanitizedBaseUrl.replace(/^https?:\/\//, '')],
                            path: pathSegments,
                            ...(queryEntries.length > 0 ? { query: queryEntries } : {}),
                        },
                        ...(hasBody
                            ? {
                                  body: {
                                      mode: 'raw',
                                      raw: JSON.stringify(selectedEndpoint.bodyExample, null, 2),
                                      options: { raw: { language: 'json' } },
                                  },
                              }
                            : {}),
                    },
                },
            ],
        };
    }, [baseUrl, selectedEndpoint]);

    const curlSnippet = useMemo(() => {
        const sanitizedBaseUrl = baseUrl.replace(/\/$/, '');
        const authHeaders = selectedEndpoint.requiresAuth
            ? [{ key: 'Authorization', value: 'Bearer {{access_token}}' }]
            : [];
        const headers = [...authHeaders, ...(selectedEndpoint.headers ?? [])];

        const queryEntries = (selectedEndpoint.queryParams ?? []).map((entry) => ({
            key: entry.key,
            value: entry.value ?? `{{${entry.key}}}`,
        }));
        const queryString =
            queryEntries.length > 0 ? queryEntries.map((entry) => `${entry.key}=${entry.value}`).join('&') : '';
        const urlWithQuery = queryString
            ? `${sanitizedBaseUrl}${selectedEndpoint.path}?${queryString}`
            : `${sanitizedBaseUrl}${selectedEndpoint.path}`;

        const lines = [`curl --request ${selectedEndpoint.method} \\`, `  --url \"${urlWithQuery}\"`];
        headers.forEach((header) => {
            lines.push(`  --header \"${header.key}: ${header.value}\"`);
        });

        const hasBody = selectedEndpoint.bodyExample && Object.keys(selectedEndpoint.bodyExample).length > 0;
        const hasContentTypeHeader = headers.some((header) => header.key.toLowerCase() === 'content-type');
        if (hasBody) {
            if (!hasContentTypeHeader) {
                lines.push('  --header \"Content-Type: application/json\"');
            }
            lines.push(`  --data '${JSON.stringify(selectedEndpoint.bodyExample)}'`);
        }
        return lines.join(' \\\n');
    }, [baseUrl, selectedEndpoint]);

    const activeKeyMeta = useMemo(
        () => keyHistory.find((entry) => entry.id === activeKeyId) ?? null,
        [keyHistory, activeKeyId],
    );

    const normalizeScopes = (scopes: string[]): string[] => Array.from(new Set(scopes)).sort();

    const rememberKey = (record: GeneratedKeyRecord) => {
        setKeyHistory((previous) => {
            const next = [record, ...previous.filter((entry) => entry.id !== record.id)];
            return next.slice(0, MAX_KEY_HISTORY);
        });
    };

    const handleLoadStoredKey = (record: GeneratedKeyRecord) => {
        setTokenName(record.label);
        setBaseUrl(record.baseUrl);
        setSelectedScopes(record.scopes);
        setGeneratedKey(record.key);
        setActiveKeyId(record.id);
        setTokenError(null);
        setHasHydratedFromHistory(true);
    };

    const handleDeleteStoredKey = (recordId: string) => {
        setKeyHistory((previous) => previous.filter((entry) => entry.id !== recordId));
        if (activeKeyId === recordId) {
            setActiveKeyId(null);
        }
    };

    const handleClearKeyHistory = () => {
        setKeyHistory([]);
        setActiveKeyId(null);
        setGeneratedKey('');
        setHasHydratedFromHistory(false);
    };

    const handleCopy = async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(label);
            setTimeout(() => setCopiedField(null), 2000);
        } catch (error) {
            console.error('Copy failed', error);
        }
    };

    const resolveExpiryMinutes = () => {
        const preset = EXPIRY_PRESETS.find((item) => item.id === expiryPresetId);
        if (!preset) {
            return null;
        }
        if (preset.id !== 'custom') {
            return preset.minutes ?? null;
        }
        if (typeof customExpiryMinutes === 'number' && customExpiryMinutes > 0) {
            if (customExpiryMinutes > LONG_LIVED_MINUTES) {
                setExpiryError('Custom minutes exceed the 10-year maximum.');
                return null;
            }
            return Math.round(customExpiryMinutes);
        }
        if (!customExpiryAt) {
            setExpiryError('Select a future date/time or provide custom minutes.');
            return null;
        }
        const target = new Date(customExpiryAt);
        if (Number.isNaN(target.getTime())) {
            setExpiryError('Select a valid expiry date/time.');
            return null;
        }
        const diffMinutes = Math.ceil((target.getTime() - Date.now()) / 60000);
        if (diffMinutes < 5) {
            setExpiryError('Expiry must be at least 5 minutes in the future.');
            return null;
        }
        if (diffMinutes > LONG_LIVED_MINUTES) {
            setExpiryError('Expiry cannot exceed 10 years from now.');
            return null;
        }
        return diffMinutes;
    };

    const generateBearerKey = async () => {
        setTokenError(null);
        setExpiryError(null);
        setIsGenerating(true);
        try {
            const expiresInMinutes = resolveExpiryMinutes();
            if (!expiresInMinutes) {
                setIsGenerating(false);
                return;
            }
            const response = await api.generateBearerToken({
                label: tokenName.trim() || undefined,
                scopes: selectedScopes,
                expires_in_minutes: expiresInMinutes,
            });
            const recordId =
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `key-${Date.now()}`;
            const record: GeneratedKeyRecord = {
                id: recordId,
                label: response.label?.trim() || tokenName.trim() || 'Untitled integration key',
                key: response.access_token,
                scopes: normalizeScopes(response.scopes ?? selectedScopes),
                baseUrl,
                createdAt: response.issued_at ?? new Date().toISOString(),
                expiresAt: response.expires_at,
                subject: response.subject,
            };
            setGeneratedKey(record.key);
            setActiveKeyId(record.id);
            setHasHydratedFromHistory(true);
            rememberKey(record);
        } catch (error) {
            console.error('Failed to generate bearer key', error);
            if (error instanceof Error) {
                setTokenError(error.message);
            } else {
                setTokenError('Unable to generate bearer key. Please try again.');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-6">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex flex-col gap-4">
                    <div className="flex items-center space-x-3">
                        <div className="p-3 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl">
                            <KeyIcon className="h-8 w-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">API & OAuth Management</h1>
                            <p className="text-gray-600 dark:text-gray-300 mt-1">
                                Manage integrations, generate credentials, and explore endpoint documentation.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { id: 'overview', label: 'Overview' },
                            { id: 'documentation', label: 'Documentation' },
                            { id: 'token', label: 'Bearer Key Builder' },
                            { id: 'webhooks', label: 'Webhooks' },
                            { id: 'smtp', label: 'SMTP' },
                            { id: 'oauth', label: 'OAuth' },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                                    activeTab === tab.id
                                        ? 'bg-blue-600 text-white shadow'
                                        : 'bg-white/70 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </header>

                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <>
                        <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <StatCard title="OAuth Apps" value={stats.totalApps} icon={<CodeBracketSquareIcon className="h-8 w-8 text-blue-500" />} />
                            <StatCard title="API Keys" value={stats.totalKeys} icon={<KeyIcon className="h-8 w-8 text-green-500" />} />
                            <StatCard
                                title="Total Calls"
                                value={stats.totalCalls.toLocaleString()}
                                icon={<ChartBarIcon className="h-8 w-8 text-purple-500" />}
                            />
                            <StatCard
                                title="Active Keys"
                                value={stats.activeKeys}
                                icon={<CheckCircleIcon className="h-8 w-8 text-orange-500" />}
                            />
                        </section>

                        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {[
                                {
                                    title: 'OAuth Apps',
                                    description: 'Manage OAuth 2.0 applications and client credentials.',
                                    icon: <CodeBracketSquareIcon className="h-8 w-8 text-blue-500" />,
                                    path: '/api/oauth-apps',
                                    stats: `${stats.totalApps} apps`,
                                },
                                {
                                    title: 'API Keys',
                                    description: 'Generate and manage API keys with custom scopes.',
                                    icon: <KeyIcon className="h-8 w-8 text-green-500" />,
                                    path: '/api/keys',
                                    stats: `${stats.activeKeys}/${stats.totalKeys} active`,
                                },
                                {
                                    title: 'Scopes',
                                    description: 'Define and manage API access permissions.',
                                    icon: <CheckCircleIcon className="h-8 w-8 text-purple-500" />,
                                    path: '/api/scopes',
                                    stats: '12 scopes',
                                },
                                {
                                    title: 'Documentation',
                                    description: 'Interactive API documentation and testing.',
                                    icon: <DocumentTextIcon className="h-8 w-8 text-orange-500" />,
                                    path: '/api/docs',
                                    stats: 'OpenAPI 3.0',
                                },
                            ].map((section, index) => (
                                <Link
                                    key={index}
                                    to={section.path}
                                    className="group bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-700 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                                >
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center space-x-4">
                                            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                                                {section.icon}
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                                    {section.title}
                                                </h3>
                                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{section.description}</p>
                                            </div>
                                        </div>
                                        <ArrowRightIcon className="h-5 w-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{section.stats}</span>
                                        <div className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 group-hover:translate-x-1 transition-transform">
                                            <span className="text-sm font-medium">Explore</span>
                                            <ArrowRightIcon className="h-4 w-4" />
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </section>


                        <section className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-white">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-bold mb-2">Quick Start</h3>
                                    <p className="text-blue-100 mb-4">Get started with your first OAuth app or API key in minutes.</p>
                                    <div className="flex flex-wrap gap-4">
                                        <button className="bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors flex items-center space-x-2">
                                            <SparklesIcon className="h-4 w-4" />
                                            <span>Create OAuth App</span>
                                        </button>
                                        <button className="bg-blue-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-400 transition-colors flex items-center space-x-2">
                                            <KeyIcon className="h-4 w-4" />
                                            <span>Generate API Key</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="hidden md:block">
                                    <Cog6ToothIcon className="h-16 w-16 text-blue-200 opacity-50" />
                                </div>
                            </div>
                        </section>
                    </>
                )}

                {activeTab === 'documentation' && (
                    <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr_1fr] gap-6">
                        <aside className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 space-y-4 overflow-y-auto pr-4 max-h-[70vh] lg:max-h-[80vh]">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <DocumentTextIcon className="h-5 w-5 text-blue-500" />
                                    Endpoint Catalogue
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    Select any endpoint to view Postman-ready payloads and curl helpers.
                                </p>
                            </div>
                            <div className="space-y-4">
                                {ENDPOINT_GROUPS.map((group) => (
                                    <div key={group.category}>
                                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                                            {group.category}
                                        </h3>
                                        <div className="space-y-2">
                                            {group.endpoints.map((endpoint) => {
                                                const isActive = selectedEndpoint.id === endpoint.id;
                                                return (
                                                    <button
                                                        key={endpoint.id}
                                                        type="button"
                                                        onClick={() => setSelectedEndpoint(endpoint)}
                                                        className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition ${
                                                            isActive
                                                                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-200'
                                                                : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-blue-300 dark:hover:border-blue-500'
                                                        }`}
                                                    >
                                                        <span className="mr-2 font-semibold">{endpoint.method}</span>
                                                        {endpoint.path}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </aside>

                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs uppercase font-semibold tracking-wide text-blue-500">{selectedEndpoint.method}</p>
                                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{selectedEndpoint.title}</h2>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{selectedEndpoint.summary}</p>
                                </div>
                                <div className="text-right">
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">Base URL</label>
                                    <input
                                        value={baseUrl}
                                        onChange={(event) => setBaseUrl(event.target.value)}
                                        className="w-48 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 focus:border-blue-500 focus:outline-none"
                                    />
                                </div>
                        </div>

                        <div className="space-y-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Scopes</h3>
                                    {selectedEndpoint.requiresAuth ? (
                                        selectedEndpoint.scopes && selectedEndpoint.scopes.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {selectedEndpoint.scopes.map((scope) => (
                                                    <span
                                                        key={scope}
                                                        className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 px-3 py-1 text-xs font-medium"
                                                    >
                                                        {scope}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-gray-600 dark:text-gray-400">
                                                Authenticated route (no granular scope enforcement).
                                            </p>
                                        )
                                    ) : (
                                        <p className="text-xs text-gray-600 dark:text-gray-400">Public endpoint (no token required).</p>
                                    )}
                                </div>
                                {selectedEndpoint.headers && selectedEndpoint.headers.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-2">
                                            <UserIcon className="h-4 w-4 text-blue-500" />
                                            Headers
                                        </h3>
                                        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                                            {selectedEndpoint.headers.map((header) => (
                                                <li key={header.key}>
                                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{header.key}:</span> {header.value}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {selectedEndpoint.queryParams && selectedEndpoint.queryParams.length > 0 && (
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Query Parameters</h3>
                                        <ul className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                                            {selectedEndpoint.queryParams.map((param) => (
                                                <li key={param.key}>
                                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{param.key}</span> – {param.description ?? param.value ?? 'value'}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                    <ClipboardDocumentListIcon className="h-4 w-4 text-blue-500" />
                                    Postman Collection Snippet
                                </h3>
                                <pre className="rounded-lg bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto">
                                    {JSON.stringify(postmanSnippet, null, 2)}
                                </pre>
                                <div className="flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(JSON.stringify(postmanSnippet, null, 2), 'postman')}
                                        className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                    >
                                        Copy JSON
                                    </button>
                                    {copiedField === 'postman' && <span className="text-xs text-green-600 dark:text-green-400">Copied!</span>}
                                </div>
                            </div>
                        </div>

                        <aside className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <SparklesIcon className="h-5 w-5 text-blue-500" />
                                    Test Window
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Use the curl command below or paste the Postman snippet into your workspace to test the endpoint.
                                </p>
                            </div>
                            <pre className="rounded-lg bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto">{curlSnippet}</pre>
                            <button
                                type="button"
                                onClick={() => handleCopy(curlSnippet, 'curl')}
                                className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                Copy curl
                            </button>
                            {copiedField === 'curl' && <span className="block text-xs text-green-600 dark:text-green-400">Copied!</span>}
                            <div className="rounded-lg border border-dashed border-blue-400 bg-blue-50/40 dark:bg-blue-900/20 p-4">
                                <h4 className="text-sm font-semibold text-blue-600 dark:text-blue-300 mb-1">Tip</h4>
                                <p className="text-xs text-blue-700 dark:text-blue-200">
                                    Set <span className="font-semibold">Authorization</span> to <code>Bearer {'{{access_token}}'}</code> in Postman to avoid auth errors on secured endpoints.
                                </p>
                            </div>
                        </aside>
                    </section>
                )}



                {activeTab === 'webhooks' && (
                    <section className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
                        <aside className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                    <ClipboardDocumentListIcon className="h-5 w-5 text-blue-500" />
                                    Webhook events
                                </h2>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Pick the events that should trigger the active webhook.
                                </p>
                            </div>
                            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
                                {webhookEventGroups.map((group) => (
                                    <div key={group.id} className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                                    {group.label}
                                                </h3>
                                                <p className="text-[11px] text-gray-500 dark:text-gray-500">{group.description}</p>
                                            </div>
                                            <span className="text-[11px] text-gray-400 dark:text-gray-500">
                                                {
                                                    group.events.filter((event) =>
                                                        webhookDraft.subscribedEvents.includes(event.id),
                                                    ).length
                                                }
                                            </span>
                                        </div>
                                        <div className="space-y-2">
                                            {group.events.map((event) => {
                                                const isSelected = webhookDraft.subscribedEvents.includes(event.id);
                                                return (
                                                    <button
                                                        key={event.id}
                                                        type="button"
                                                        onClick={() => handleToggleWebhookEvent(event.id)}
                                                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                                                            isSelected
                                                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-900/30 dark:text-emerald-200'
                                                                : 'border-gray-200 text-gray-700 hover:border-blue-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-blue-500'
                                                        }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <p className="text-sm font-semibold">{event.label}</p>
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">{event.description}</p>
                                                            </div>
                                                            <span
                                                                className={`mt-1 h-2.5 w-2.5 rounded-full border ${
                                                                    isSelected
                                                                        ? 'border-emerald-400 bg-emerald-400'
                                                                        : 'border-gray-300 dark:border-gray-600'
                                                                }`}
                                                            />
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </aside>

                        <div className="space-y-6">
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Webhook endpoints</h2>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            Add and manage webhook destinations for your workspace.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleNewWebhook}
                                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-blue-500"
                                    >
                                        <PlusIcon className="h-4 w-4" />
                                        New webhook
                                    </button>
                                </div>
                                {webhookError && (
                                    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:border-rose-500/40 dark:bg-rose-900/20 dark:text-rose-200">
                                        {webhookError}
                                    </div>
                                )}
                                {isLoadingWebhooks ? (
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Loading webhooks...</p>
                                ) : webhooks.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                                        No webhooks yet. Create your first endpoint to start receiving events.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {webhooks.map((webhook) => {
                                            const isActive = webhook.id === activeWebhookId;
                                            return (
                                                <div
                                                    key={webhook.id}
                                                    className={`rounded-xl border p-4 transition ${
                                                        isActive
                                                            ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500/70 dark:bg-blue-900/20'
                                                            : 'border-gray-200 dark:border-gray-700'
                                                    }`}
                                                >
                                                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSelectWebhook(webhook)}
                                                            className="flex-1 text-left space-y-2"
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                                                    {webhook.name}
                                                                </p>
                                                                <span
                                                                    className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                                                                        webhook.isEnabled
                                                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-200'
                                                                            : 'border-gray-300 bg-gray-100 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                                                    }`}
                                                                >
                                                                    {webhook.isEnabled ? 'Enabled' : 'Disabled'}
                                                                </span>
                                                            </div>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">{webhook.url}</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {webhook.subscribedEvents.map((eventId) => (
                                                                    <span
                                                                        key={`${webhook.id}-${eventId}`}
                                                                        className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 px-2.5 py-0.5 text-[10px] font-medium"
                                                                    >
                                                                        {webhookEventLabelMap.get(eventId) ?? eventId}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </button>
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleWebhookEnabled(webhook)}
                                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                                                    webhook.isEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                                                                }`}
                                                            >
                                                                <span
                                                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                                                                        webhook.isEnabled ? 'translate-x-6' : 'translate-x-1'
                                                                    }`}
                                                                />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteWebhook(webhook.id)}
                                                                className="rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-200 dark:hover:bg-rose-900/30"
                                                            >
                                                                <TrashIcon className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Webhook editor</h3>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            Configure name, destinations, events, and custom headers.
                                        </p>
                                    </div>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {webhookDraft.id ? 'Editing saved webhook' : 'New webhook'}
                                    </span>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                        Webhook name
                                        <input
                                            value={webhookDraft.name}
                                            onChange={(event) =>
                                                setWebhookDraft((prev) => ({ ...prev, name: event.target.value }))
                                            }
                                            className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                            placeholder="e.g. ZeaPlay primary webhook"
                                        />
                                    </label>
                                    <div className="flex items-center justify-between rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-300">Enabled</span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setWebhookDraft((prev) => ({ ...prev, isEnabled: !prev.isEnabled }))
                                            }
                                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                                                webhookDraft.isEnabled
                                                    ? 'bg-emerald-500'
                                                    : 'bg-gray-300 dark:bg-gray-600'
                                            }`}
                                        >
                                            <span
                                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                                                    webhookDraft.isEnabled ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                            />
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Webhook URLs</label>
                                    <div className="space-y-2">
                                        {webhookDraft.urls.map((url, index) => (
                                            <div key={`url-${index}`} className="flex items-center gap-2">
                                                <input
                                                    value={url}
                                                    onChange={(event) => handleWebhookUrlChange(index, event.target.value)}
                                                    className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                                    placeholder="https://hooks.yourservice.com/zeaplay"
                                                />
                                                {webhookDraft.urls.length > 1 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveWebhookUrl(index)}
                                                        className="rounded-md border border-gray-300 dark:border-gray-700 px-2 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddWebhookUrl}
                                        className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                        <PlusIcon className="h-3.5 w-3.5" />
                                        Add URL
                                    </button>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                        Each URL is saved as its own webhook entry.
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Subscribed events</label>
                                    {webhookDraft.subscribedEvents.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {webhookDraft.subscribedEvents.map((eventId) => (
                                                <span
                                                    key={`selected-${eventId}`}
                                                    className="inline-flex items-center gap-2 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 px-3 py-1 text-xs font-medium"
                                                >
                                                    {webhookEventLabelMap.get(eventId) ?? eventId}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleToggleWebhookEvent(eventId)}
                                                        className="text-[10px] uppercase"
                                                    >
                                                        x
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Select events from the left panel.
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Custom headers</label>
                                    <div className="space-y-2">
                                        {webhookDraft.customHeaders.map((header, index) => (
                                            <div key={header.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
                                                <input
                                                    value={header.key}
                                                    onChange={(event) => handleHeaderChange(header.id, 'key', event.target.value)}
                                                    className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                                    placeholder="Header name"
                                                />
                                                <input
                                                    value={header.value}
                                                    onChange={(event) => handleHeaderChange(header.id, 'value', event.target.value)}
                                                    className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                                    placeholder="Header value"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveHeader(header.id)}
                                                    className="rounded-md border border-gray-300 dark:border-gray-700 px-2 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                >
                                                    {index === 0 && webhookDraft.customHeaders.length === 1 ? 'Clear' : 'Remove'}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddHeader}
                                        className="inline-flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                        <PlusIcon className="h-3.5 w-3.5" />
                                        Add header
                                    </button>
                                </div>

                                <div className="flex flex-wrap items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={handleSaveWebhook}
                                        disabled={isSavingWebhook}
                                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500 disabled:opacity-60"
                                    >
                                        <SparklesIcon className="h-4 w-4" />
                                        {isSavingWebhook ? 'Saving...' : 'Save webhook'}
                                    </button>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Save after selecting events and URLs.
                                    </span>
                                </div>

                                {webhookDraft.id && (
                                    <div className="rounded-xl border border-dashed border-blue-300 dark:border-blue-600 bg-blue-50/60 dark:bg-blue-900/20 p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-200">Test webhook</h4>
                                                <p className="text-xs text-blue-600 dark:text-blue-300">
                                                    Sends a real sample payload from the database.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleTestWebhook}
                                                disabled={isTestingWebhook || webhookDraft.subscribedEvents.length === 0}
                                                className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-500 disabled:opacity-60"
                                            >
                                                {isTestingWebhook ? 'Testing...' : 'Send test'}
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label className="text-xs font-semibold text-blue-700 dark:text-blue-200">
                                                Event
                                                <select
                                                    value={testEventName}
                                                    onChange={(event) => setTestEventName(event.target.value)}
                                                    className="ml-2 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs text-blue-700 dark:border-blue-600 dark:bg-blue-950 dark:text-blue-200"
                                                >
                                                    {webhookDraft.subscribedEvents.map((eventId) => (
                                                        <option key={`test-${eventId}`} value={eventId}>
                                                            {webhookEventLabelMap.get(eventId) ?? eventId}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                        {testResult && (
                                            <div className="rounded-lg border border-blue-200 bg-white/80 dark:border-blue-700/60 dark:bg-blue-950/40 p-3 text-xs text-blue-800 dark:text-blue-200 space-y-2">
                                                <div className="flex flex-wrap gap-4">
                                                    <span>Status: {testResult.statusCode ?? 'No response'}</span>
                                                    <span>
                                                        Time: {testResult.responseTimeMs ? `${testResult.responseTimeMs} ms` : 'n/a'}
                                                    </span>
                                                    {testResult.deliveredAt && (
                                                        <span>
                                                            Sent: {new Date(testResult.deliveredAt).toLocaleString()}
                                                        </span>
                                                    )}
                                                </div>
                                                {testResult.errorMessage && (
                                                    <p className="text-rose-600 dark:text-rose-300">Error: {testResult.errorMessage}</p>
                                                )}
                                                {testResult.responseBody && (
                                                    <pre className="whitespace-pre-wrap rounded-md bg-blue-900/5 dark:bg-blue-900/40 p-2 text-[11px] text-blue-900 dark:text-blue-100">
                                                        {testResult.responseBody}
                                                    </pre>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}
                {activeTab === 'token' && (
                    <section className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">

                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                <KeyIcon className="h-5 w-5 text-blue-500" />
                                Generate Bearer Key
                            </h2>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Use this helper to prototype API keys with scoped permissions. Generated keys are local to your browser session.
                            </p>
                            <div className="space-y-3">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Key label
                                    <input
                                        value={tokenName}
                                        onChange={(event) => setTokenName(event.target.value)}
                                        className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                        placeholder="Integration name"
                                    />
                                </label>

                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select scopes</label>

                                <div className="relative w-full truncate p-3 overflow-x-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                                    <MultiSelect
                                    options={SCOPE_OPTIONS}
                                    value={selectedScopes}
                                    onChange={setSelectedScopes}
                                    placeholder="Choose scopes..."
                                    />
                                    </div>

                                {/* SELECT / CLEAR LINKS */}
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleSelectAllScopes}
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                        Select all scopes
                                    </button>
                                    <span className="text-gray-300 dark:text-gray-700">•</span>
                                    <button
                                        type="button"
                                        onClick={handleClearScopes}
                                        className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3">
                                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Scopes preview</p>
                                    <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1">
                                        {selectedScopes.map((scope) => (
                                            <span
                                                key={scope}
                                                className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 px-3 py-1 text-xs font-medium"
                                            >
                                                {scopeLabel(scope)}
                                            </span>
                                        ))}
                                        {selectedScopes.length === 0 && (
                                            <span className="text-xs text-gray-500 dark:text-gray-400">No scopes selected. Key will have minimal access.</span>
                                        )}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Expires</label>
                                        <button
                                            type="button"
                                            onClick={() => setShowAdvancedExpiry((prev) => !prev)}
                                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                        >
                                            {showAdvancedExpiry ? 'Hide advanced' : 'Advanced options'}
                                        </button>
                                    </div>
                                    <select
                                        value={expiryPresetId}
                                        onChange={(event) => {
                                            setExpiryPresetId(event.target.value);
                                            setExpiryError(null);
                                        }}
                                        className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                    >
                                        {EXPIRY_PRESETS.map((preset) => (
                                            <option key={preset.id} value={preset.id}>
                                                {preset.label}
                                            </option>
                                        ))}
                                    </select>
                                    {expiryPresetId === 'custom' && (
                                        <div className="space-y-2">
                                            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                                                Calendar date & time (local)
                                                <input
                                                    type="datetime-local"
                                                    value={customExpiryAt}
                                                    onChange={(event) => {
                                                        setCustomExpiryAt(event.target.value);
                                                        setCustomExpiryMinutes('');
                                                        setExpiryError(null);
                                                    }}
                                                    className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                                />
                                            </label>
                                        </div>
                                    )}
                                    {showAdvancedExpiry && expiryPresetId === 'custom' && (
                                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                                            Custom minutes
                                            <input
                                                type="number"
                                                min={5}
                                                value={customExpiryMinutes}
                                                onChange={(event) => {
                                                    const value = event.target.value;
                                                    setCustomExpiryMinutes(value === '' ? '' : Number(value));
                                                    if (value !== '') {
                                                        setCustomExpiryAt('');
                                                    }
                                                    setExpiryError(null);
                                                }}
                                                className="mt-1 w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:border-blue-500 focus:outline-none"
                                                placeholder="e.g. 1440"
                                            />
                                        </label>
                                    )}
                                    {showAdvancedExpiry && expiryPresetId !== 'custom' && (
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                            Switch to custom date/time to set minutes or a calendar expiry.
                                        </p>
                                    )}
                                    {expiryPreviewLabel && (
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                            Expires on {expiryPreviewLabel}
                                        </p>
                                    )}
                                    {expiryPresetId === 'never' && (
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                            Never expire issues a long-lived token (10 years).
                                        </p>
                                    )}
                                    {expiryError && (
                                        <p className="text-[11px] text-red-500 dark:text-red-400">{expiryError}</p>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={generateBearerKey}
                                    disabled={isGenerating}
                                    className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    <SparklesIcon className="h-4 w-4" />
                                    {isGenerating ? 'Generating…' : 'Generate Key'}
                                </button>
                                {tokenError && (
                                    <p className="mt-2 text-xs text-red-500 dark:text-red-400">{tokenError}</p>
                                )}
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-6 shadow-sm">

                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bearer Key Preview</h3>
                            {generatedKey ? (
                                <>
                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Generated key</label>
                                        <div className="flex items-center gap-2">
                                            <input
                                                value={generatedKey}
                                                readOnly
                                                className="flex-1 truncate overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(generatedKey, 'key')}
                                                className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                            >
                                                Copy
                                            </button>
                                        </div>
                                        {copiedField === 'key' && <span className="text-xs text-green-600 dark:text-green-400">Copied!</span>}
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Authorization header</label>
                                        <pre className="rounded-lg bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto">{`Bearer ${generatedKey}`}</pre>
                                    </div>

                                    {activeKeyMeta && (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div className="space-y-1">
                                                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Issued</p>
                                                <p className="text-xs text-gray-700 dark:text-gray-200">
                                                    {new Date(activeKeyMeta.createdAt).toLocaleString()}
                                                </p>
                                            </div>
                                            {activeKeyMeta.expiresAt && (
                                                <div className="space-y-1">
                                                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Expires</p>
                                                    <p className="text-xs text-gray-700 dark:text-gray-200">
                                                        {new Date(activeKeyMeta.expiresAt).toLocaleString()}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Postman environment snippet</label>
                                        <pre className="rounded-lg bg-gray-900 text-gray-100 text-xs p-4 overflow-x-auto">
                                            {JSON.stringify(
                                                {
                                                    name: tokenName,
                                                    values: [
                                                        { key: 'baseUrl', value: baseUrl, type: 'default' },
                                                        { key: 'access_token', value: generatedKey, type: 'secret' },
                                                        { key: 'scopes', value: selectedScopes.join(','), type: 'text' },
                                                    ],
                                                },
                                                null,
                                                2,
                                            )}
                                        </pre>
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-lg border border-dashed border-blue-400 bg-blue-50/60 dark:bg-blue-900/20 p-6 text-center">
                                    <SparklesIcon className="mx-auto h-8 w-8 text-blue-500 mb-3" />
                                    <p className="text-sm text-blue-700 dark:text-blue-200">
                                        Select scopes and click <span className="font-semibold">Generate Key</span> to see the token preview and sharing snippets.
                                    </p>
                                </div>
                            )}
                            {keyHistory.length > 0 && (
                                <div className="pt-5 mt-5 border-t border-gray-200 dark:border-gray-700 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Saved bearer keys (browser only)</h4>
                                        <button
                                            type="button"
                                            onClick={handleClearKeyHistory}
                                            className="text-xs text-gray-600 dark:text-gray-400 hover:underline"
                                        >
                                            Clear all
                                        </button>
                                    </div>
                                    <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
                                        {keyHistory.map((record) => {
                                            const created = new Date(record.createdAt);
                                            const createdLabel = Number.isNaN(created.getTime())
                                                ? record.createdAt
                                                : created.toLocaleString();
                                            const isActive = record.id === activeKeyId;
                                            const cardClasses = [
                                                'rounded-lg',
                                                'border',
                                                'p-4',
                                                'space-y-3',
                                                'bg-white',
                                                'dark:bg-gray-900/40',
                                                isActive ? 'border-blue-400 dark:border-blue-500' : 'border-gray-200 dark:border-gray-700',
                                            ].join(' ');
                                            return (
                                                <div key={record.id} className={`${cardClasses} flex flex-col gap-3`}>
                                                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3">
                                                        <div>
                                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{record.label}</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">{createdLabel}</p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400">Base URL: {record.baseUrl}</p>
                                                            {record.expiresAt && (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                                    Expires: {new Date(record.expiresAt).toLocaleString()}
                                                                </p>
                                                            )}
                                                            {record.subject && (
                                                                <p className="text-xs text-gray-500 dark:text-gray-400">Subject: {record.subject}</p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleLoadStoredKey(record)}
                                                                className="rounded-md border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                            >
                                                                Load into builder
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteStoredKey(record.id)}
                                                                className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30"
                                                            >
                                                                Delete
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="space-y-1">
                                                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Bearer key</label>
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    value={record.key}
                                                                    readOnly
                                                                    className="flex-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-xs text-gray-700 dark:text-gray-200"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopy(record.key, `history-key-${record.id}`)}
                                                                    className="rounded-md border border-gray-300 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                                >
                                                                    Copy
                                                                </button>
                                                            </div>
                                                            {copiedField === `history-key-${record.id}` && (
                                                                <span className="text-xs text-green-600 dark:text-green-400">Copied!</span>
                                                            )}
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                                                Authorization header
                                                            </label>
                                                            <pre className="rounded-md bg-gray-900 text-gray-100 text-[11px] leading-relaxed px-3 py-2 overflow-x-auto">{`Bearer ${record.key}`}</pre>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleCopy(`Bearer ${record.key}`, `history-header-${record.id}`)
                                                                }
                                                                className="rounded-md border border-gray-300 dark:border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                                                            >
                                                                Copy header
                                                            </button>
                                                            {copiedField === `history-header-${record.id}` && (
                                                                <span className="text-xs text-green-600 dark:text-green-400">Copied!</span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="space-y-1">
                                                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Scopes</p>
                                                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                                                            {record.scopes.length > 0 ? (
                                                                record.scopes.map((scopeId) => (
                                                                    <span
                                                                        key={`${record.id}-${scopeId}`}
                                                                        className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200 px-3 py-1 text-[11px] font-medium"
                                                                    >
                                                                        {scopeLabel(scopeId)}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                                    No scopes attached to this key.
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

const StatCard: React.FC<{ title: string; value: number | string; icon: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
            <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
            </div>
            {icon}
        </div>
    </div>
);

export default ApiOverview;



