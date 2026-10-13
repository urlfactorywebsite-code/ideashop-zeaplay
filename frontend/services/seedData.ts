// --- title: services/seedData.ts ---
import {
  User,
  Task,
  Comment,
  Department,
  Role,
  TaskPriority,
  RecurrenceRule,
  UserStatus,
  KanbanColumn,
  TaskStatus,
  Achievement,
  Reward,
  Notification,
  NotificationType,
  RewardImageSource,
  RewardStatus,
} from '../types';

const today = new Date();
const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// --- USERS ---
export const SEED_USERS: User[] = [
  { id: 'user-1', name: 'Alice Johnson', email: 'owner@example.com', role: Role.OWNER, department: 'Management', passwordHash: 'hashed_password_owner', status: UserStatus.ACTIVE, points: 185, unlockedAchievementIds: ['ach-1'], tasksCreated: 3, tasksCompleted: 2, clarityScores: [5, 4], claimedRewardIds: [] },
  { id: 'user-2', name: 'Bob Williams', email: 'admin@example.com', role: Role.ADMIN, department: 'Hyper Automation', passwordHash: 'hashed_password_admin', status: UserStatus.ACTIVE, points: 75, unlockedAchievementIds: ['ach-1'], tasksCreated: 4, tasksCompleted: 1, clarityScores: [3], claimedRewardIds: [] },
  { id: 'user-3', name: 'Charlie Brown', email: 'user@example.com', role: Role.USER, department: 'Marketing Team', passwordHash: 'hashed_password_user', status: UserStatus.ACTIVE, points: 250, unlockedAchievementIds: ['ach-1', 'ach-2'], tasksCreated: 1, tasksCompleted: 5, clarityScores: [], claimedRewardIds: [] },
  { id: 'user-4', name: 'Diana Miller', email: 'diana@example.com', role: Role.USER, department: 'Hyper Automation', passwordHash: 'hashed_password_diana', status: UserStatus.ACTIVE, points: 50, unlockedAchievementIds: [], tasksCreated: 0, tasksCompleted: 3, clarityScores: [], claimedRewardIds: [] },
  { id: 'user-5', name: 'Ethan Davis', email: 'ethan@example.com', role: Role.USER, department: 'IT Support', passwordHash: 'hashed_password_ethan', status: UserStatus.ACTIVE, points: 120, unlockedAchievementIds: ['ach-1'], tasksCreated: 1, tasksCompleted: 1, clarityScores: [], claimedRewardIds: [] },
];

// --- ACHIEVEMENTS ---
export const SEED_ACHIEVEMENTS: Achievement[] = [
    { id: 'ach-1', title: 'First Task Completed', description: 'Complete your first task.', points: 25, icon: 'RocketLaunch' },
    { id: 'ach-2', title: 'Task Master', description: 'Complete 5 tasks.', points: 50, icon: 'AcademicCap' },
    { id: 'ach-3', title: 'High Flyer', description: 'Complete 3 High or Urgent priority tasks.', points: 75, icon: 'Bolt' },
    { id: 'ach-4', title: 'Urgent Responder', description: 'Complete an Urgent priority task.', points: 100, icon: 'Fire' },
    { id: 'ach-5', title: 'Architect', description: 'Create 5 tasks for your team.', points: 50, icon: 'Clipboard' },
    { id: 'ach-6', title: 'Clear Communicator', description: 'Receive an average task clarity score of 4+.', points: 100, icon: 'Sparkles' },
];

// --- REWARDS ---
const now = new Date().toISOString();

export const SEED_REWARDS: Reward[] = [
  {
    id: 'rew-1',
    title: 'Coffee Voucher',
    description: 'Get a free coffee on us!',
    imageSource: RewardImageSource.LIBRARY,
    imageRef: null,
    imageUrl: null,
    xpRequired: 500,
    deptWhitelist: [],
    autoRedeem: true,
    allowMultipleClaims: false,
    expiresAt: null,
    status: RewardStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    createdById: null,
    updatedById: null,
  },
  {
    id: 'rew-2',
    title: 'Gift Card',
    description: 'A gift card for your favorite store.',
    imageSource: RewardImageSource.LIBRARY,
    imageRef: null,
    imageUrl: null,
    xpRequired: 1000,
    deptWhitelist: [],
    autoRedeem: false,
    allowMultipleClaims: false,
    expiresAt: null,
    status: RewardStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    createdById: null,
    updatedById: null,
  },
  {
    id: 'rew-test',
    title: 'Testing Reward',
    description: 'This is a test reward for notifications.',
    imageSource: RewardImageSource.LIBRARY,
    imageRef: null,
    imageUrl: null,
    xpRequired: 50,
    deptWhitelist: [],
    autoRedeem: true,
    allowMultipleClaims: true,
    expiresAt: null,
    status: RewardStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    createdById: null,
    updatedById: null,
  },
];

// --- NOTIFICATIONS ---
export const SEED_NOTIFICATIONS: Notification[] = [
    {
        id: 'notif-test-reward',
        userId: 'user-1',
        type: NotificationType.REWARD_CLAIMED,
        message: "You have claimed the reward: 'Testing Reward'.",
        isRead: false,
        relatedTaskId: null,
        relatedRewardId: 'rew-test',
        createdAt: new Date(new Date().setSeconds(new Date().getSeconds() - 6)).toISOString(),
    },
    {
        id: 'notif-1',
        userId: 'user-1', // Alice
        type: NotificationType.TASK_COMPLETED,
        message: "Charlie Brown completed the task 'Create Q3 marketing campaign materials'.",
        isRead: false,
        relatedTaskId: 'task-3',
        relatedRewardId: null,
        createdAt: addDays(today, -8).toISOString(),
    },
    {
        id: 'notif-2',
        userId: 'user-4', // Diana
        type: NotificationType.TASK_ASSIGNED,
        message: "You have been assigned a new task: 'Design new dashboard layout'.",
        isRead: true,
        relatedTaskId: 'task-1',
        relatedRewardId: null,
        createdAt: addDays(today, -10).toISOString(),
    }
];

// --- DEPARTMENTS ---
export const SEED_DEPARTMENTS: Department[] = [
    { id: 'dept-1', name: 'Data Team' },
    { id: 'dept-2', name: 'Lead Generation' },
    { id: 'dept-3', name: 'Marketing Team' },
    { id: 'dept-4', name: 'IT Support' },
    { id: 'dept-5', name: 'Sales Team' },
    { id: 'dept-6', name: 'Management' },
    { id: 'dept-7', name: 'Finance Team' },
    { id: 'dept-8', name: 'Hyper Automation' },
    { id: 'dept-9', name: 'ZeaCRM' },
    { id: 'dept-10', name: 'URL Factory' },
    { id: 'dept-11', name: 'Target Access Hub' },
    { id: 'dept-12', name: 'Client' },
    { id: 'dept-13', name: 'Other' },
];
// --- KANBAN COLUMNS ---
export const SEED_KANBAN_COLUMNS: KanbanColumn[] = [
    { id: 'WAITING_FOR_REQUIREMENT', title: 'Battle Plan', order: 0 },
    { id: 'TODO', title: 'Case Filed', order: 1 },
    { id: 'IN_PROGRESS', title: 'In Progress', order: 2 },
    { id: 'BLOCKED', title: 'Boss Encounter', order: 3 },
    { id: 'IN_REVIEW', title: 'Tactical Shift', order: 4 },
    { id: 'ON_HOLD', title: 'On Hold', order: 5 },
    { id: 'DONE', title: 'Conquered', order: 6 },
    { id: 'FAILED', title: 'Fallen', order: 7 },
    { id: 'GRAVEYARD', title: 'Graveyard', order: 8 },
];


// --- TASKS ---
export const SEED_TASKS: Task[] = [
  {
    id: 'task-1',
    title: 'Design new dashboard layout',
    description: 'Create mockups and wireframes for the new V2 dashboard. Focus on user experience and data visualization.',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    team: 'Hyper Automation',
    assignedTo: ['user-4'], // Diana
    createdBy: 'user-2', // Bob
    createdAt: addDays(today, -10).toISOString(),
    updatedAt: addDays(today, -2).toISOString(),
    dueAt: addDays(today, 5).toISOString(),
    subtasks: [
        { id: 'sub-1-1', title: 'User research', completed: true },
        { id: 'sub-1-2', title: 'Low-fidelity wireframes', completed: true },
        { id: 'sub-1-3', title: 'High-fidelity mockups', completed: false },
    ],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: ['https://example.com/design-brief', 'https://example.com/competitor-analysis'],
    estimatedHours: 16,
    tags: ['#design', '#ux', '#v2'],
  },
  {
    id: 'task-2',
    title: 'Develop user authentication feature',
    description: 'Implement JWT-based authentication for the main application API.',
    status: TaskStatus.WAITING_FOR_REQUIREMENT,
    priority: TaskPriority.URGENT,
    team: 'Hyper Automation',
    assignedTo: ['user-2'], // Bob
    createdBy: 'user-1', // Alice
    createdAt: addDays(today, -5).toISOString(),
    updatedAt: addDays(today, -1).toISOString(),
    dueAt: addDays(today, 10).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: [],
    estimatedHours: 24,
    tags: ['#backend', '#security'],
  },
  {
    id: 'task-3',
    title: 'Create Q3 marketing campaign materials',
    description: 'Prepare all assets for the upcoming Q3 campaign, including social media graphics and ad copy.',
    status: TaskStatus.DONE,
    priority: TaskPriority.MEDIUM,
    team: 'Marketing Team',
    assignedTo: ['user-3'], // Charlie
    createdBy: 'user-1', // Alice
    createdAt: addDays(today, -20).toISOString(),
    updatedAt: addDays(today, -8).toISOString(),
    dueAt: addDays(today, -10).toISOString(),
    completedAt: addDays(today, -9).toISOString(),
    subtasks: [
        { id: 'sub-3-1', title: 'Finalize campaign slogan', completed: true },
        { id: 'sub-3-2', title: 'Design ad banners', completed: true },
    ],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: 5,
    attachments: [],
    estimatedHours: 40,
    tags: ['#marketing', '#q3'],
  },
  {
    id: 'task-4',
    title: 'Test payment gateway integration',
    description: 'Perform end-to-end testing of the new Stripe integration.',
    status: TaskStatus.IN_REVIEW,
    priority: TaskPriority.HIGH,
    team: 'IT Support',
    assignedTo: ['user-5'], // Ethan
    createdBy: 'user-2', // Bob
    createdAt: addDays(today, -7).toISOString(),
    updatedAt: addDays(today, -1).toISOString(),
    dueAt: addDays(today, 2).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: [],
    estimatedHours: 8,
    tags: ['#qa', '#testing', '#payments'],
  },
   {
    id: 'task-5',
    title: 'Update user documentation for v2.5',
    description: 'Write and publish documentation for all new features released in v2.5.',
    status: TaskStatus.ON_HOLD,
    priority: TaskPriority.LOW,
    team: 'Client',
    assignedTo: ['user-4'], // Diana
    createdBy: 'user-2',
    createdAt: addDays(today, -3).toISOString(),
    updatedAt: addDays(today, -3).toISOString(),
    dueAt: addDays(today, 15).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: [],
    estimatedHours: 12,
    tags: ['#docs'],
  },
  {
    id: 'task-6',
    title: 'Weekly team sync meeting',
    description: 'Recurring weekly sync to discuss progress and blockers.',
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    team: 'Management',
    assignedTo: ['user-1'],
    createdBy: 'user-1',
    createdAt: addDays(today, -30).toISOString(),
    updatedAt: addDays(today, -1).toISOString(),
    dueAt: addDays(today, 1).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.WEEKLY,
    recurringTaskId: null,
    clarityRating: null,
    attachments: [],
    estimatedHours: 1,
    tags: ['#meeting', '#recurring'],
  },
  {
    id: 'task-7',
    title: 'Onboard new marketing intern',
    description: 'Prepare onboarding materials and schedule initial meetings.',
    status: TaskStatus.TODO,
    priority: TaskPriority.MEDIUM,
    team: 'Marketing Team',
    assignedTo: ['user-3'], // Charlie
    createdBy: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dueAt: addDays(today, 7).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: [],
    estimatedHours: 4,
    tags: ['#hr', '#onboarding'],
  },
  {
    id: 'task-8',
    title: 'Fix login button alignment on mobile',
    description: 'The login button is misaligned on screens smaller than 375px.',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    team: 'Hyper Automation',
    assignedTo: ['user-4'], // Diana
    createdBy: 'user-5', // Ethan (QA)
    createdAt: addDays(today, -1).toISOString(),
    updatedAt: addDays(today, -1).toISOString(),
    dueAt: addDays(today, 1).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: null,
    attachments: ['https://example.com/screenshot.png'],
    estimatedHours: 2,
    tags: ['#bug', '#css', '#mobile'],
  },
  {
    id: 'task-9',
    title: 'Release v2.4 to production',
    description: 'Deploy the latest build to the production environment and monitor for issues.',
    status: TaskStatus.DONE,
    priority: TaskPriority.URGENT,
    team: 'Management',
    assignedTo: ['user-1'], // Alice
    createdBy: 'user-1',
    createdAt: addDays(today, -15).toISOString(),
    updatedAt: addDays(today, -12).toISOString(),
    dueAt: addDays(today, -13).toISOString(),
    completedAt: addDays(today, -13).toISOString(),
    subtasks: [],
    recurrenceRule: RecurrenceRule.NONE,
    recurringTaskId: null,
    clarityRating: 4,
    attachments: [],
    estimatedHours: 3,
    tags: ['#deployment', '#prod'],
  }
];

// --- COMMENTS ---
export const SEED_COMMENTS: Comment[] = [
  { id: 'comment-1', taskId: 'task-1', userId: 'user-2', content: 'The low-fidelity wireframes look great, Diana! Let\'s proceed with the high-fidelity mockups.', createdAt: addDays(today, -3).toISOString() },
  { id: 'comment-2', taskId: 'task-1', userId: 'user-4', content: 'Thanks, Bob! I\'ve started on them and will share a draft by EOD tomorrow.', createdAt: addDays(today, -2).toISOString() },
  { id: 'comment-3', taskId: 'task-4', userId: 'user-2', content: 'Ethan, please make sure to test the refund process thoroughly.', createdAt: addDays(today, -1).toISOString() },
  { id: 'comment-4', taskId: 'task-5', userId: 'user-4', content: 'This task is blocked until the auth feature is complete.', createdAt: addDays(today, -3).toISOString() },
];
