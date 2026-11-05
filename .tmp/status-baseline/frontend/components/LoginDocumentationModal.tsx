import React, { useState } from 'react';
import { QuestionMarkCircleIcon, XMarkIcon } from './icons';

interface LoginDocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const LoginDocumentationModal: React.FC<LoginDocumentationModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('about');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <h2 className="text-xl font-semibold text-text-primary">Zea.Play Documentation</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-4">
          {/* Tabs */}
          <div className="flex space-x-4 mb-4 border-b border-border-color overflow-x-auto">
            <button
              className={`pb-2 px-4 whitespace-nowrap ${
                activeTab === 'about'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('about')}
            >
              About Zea.Play
            </button>
            <button
              className={`pb-2 px-4 whitespace-nowrap ${
                activeTab === 'features'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('features')}
            >
              Features
            </button>
            <button
              className={`pb-2 px-4 whitespace-nowrap ${
                activeTab === 'getting-started'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('getting-started')}
            >
              Getting Started
            </button>
            <button
              className={`pb-2 px-4 whitespace-nowrap ${
                activeTab === 'faq'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('faq')}
            >
              FAQ
            </button>
          </div>

          {/* Tab Content */}
          <div className="prose prose-sm max-w-none text-text-primary">
            {activeTab === 'about' && (
              <div>
                <h3>About Zea.Play</h3>
                <p>
                  Zea.Play is a gamified task management platform designed to make productivity fun and engaging. Built for teams and individuals who want to turn their daily work into an exciting mission, Zea.Play transforms mundane tasks into quests, streaks, and achievements.
                </p>

                <h4>Our Mission</h4>
                <p>
                  To revolutionize how people approach their work by gamifying the task management experience. We believe that when work feels like play, productivity soars, and teams achieve more together.
                </p>

                <h4>What Makes Us Different</h4>
                <ul>
                  <li><strong>Gamification First:</strong> Every interaction earns XP, unlocks achievements, and builds streaks</li>
                  <li><strong>Team Synergy:</strong> Real-time collaboration with visibility into team progress and blockers</li>
                  <li><strong>Smart Organization:</strong> AI-powered task prioritization and deadline management</li>
                  <li><strong>Beautiful Interface:</strong> Intuitive design that adapts to your workflow preferences</li>
                  <li><strong>Comprehensive Views:</strong> Multiple visualization options including Kanban, Calendar, and Gantt charts</li>
                </ul>

                <h4>Core Philosophy</h4>
                <p>
                  Work should be challenging yet rewarding. Zea.Play creates a positive feedback loop where completing tasks feels like leveling up in your favorite game. Whether you're a solo entrepreneur or part of a large development team, Zea.Play adapts to your needs while keeping the experience engaging and motivating.
                </p>
              </div>
            )}

            {activeTab === 'features' && (
              <div>
                <h3>Key Features of Zea.Play</h3>

                <h4>🎯 Task Management</h4>
                <ul>
                  <li><strong>Smart Task Creation:</strong> AI-assisted task breakdown and priority assignment</li>
                  <li><strong>Multiple Views:</strong> List, Kanban board, Calendar, and Gantt chart perspectives</li>
                  <li><strong>Advanced Filtering:</strong> Filter by status, priority, assignee, project, or custom tags</li>
                  <li><strong>Task Dependencies:</strong> Link tasks together to create workflows</li>
                  <li><strong>Time Tracking:</strong> Built-in timers and time logging for productivity analysis</li>
                </ul>

                <h4>🏆 Gamification System</h4>
                <ul>
                  <li><strong>XP & Levels:</strong> Earn experience points for completing tasks and leveling up</li>
                  <li><strong>Achievement Badges:</strong> Unlock badges for milestones and special accomplishments</li>
                  <li><strong>Daily Streaks:</strong> Maintain login and task completion streaks for bonus rewards</li>
                  <li><strong>Leaderboards:</strong> Compete with team members in friendly competition</li>
                  <li><strong>Quest System:</strong> Take on daily and weekly challenges for extra rewards</li>
                </ul>

                <h4>👥 Team Collaboration</h4>
                <ul>
                  <li><strong>Real-time Updates:</strong> See team member activity as it happens</li>
                  <li><strong>Comment Threads:</strong> Discuss tasks with @mentions and file attachments</li>
                  <li><strong>Role-based Access:</strong> Granular permissions for different team roles</li>
                  <li><strong>Team Analytics:</strong> Insights into team productivity and bottlenecks</li>
                  <li><strong>Integration Ready:</strong> Connect with Slack, Jira, GitHub, and more</li>
                </ul>

                <h4>📊 Analytics & Insights</h4>
                <ul>
                  <li><strong>Productivity Reports:</strong> Detailed analytics on your work patterns</li>
                  <li><strong>Time Analysis:</strong> Understand where your time is spent</li>
                  <li><strong>Goal Tracking:</strong> Set and monitor progress toward objectives</li>
                  <li><strong>Performance Metrics:</strong> Track velocity, completion rates, and efficiency</li>
                  <li><strong>Custom Dashboards:</strong> Build personalized analytics views</li>
                </ul>

                <h4>🎨 Customization</h4>
                <ul>
                  <li><strong>Theme Options:</strong> Light, dark, and colorful themes with system preference detection</li>
                  <li><strong>Workflow Templates:</strong> Pre-built templates for common project types</li>
                  <li><strong>Custom Fields:</strong> Add custom properties to tasks and projects</li>
                  <li><strong>Keyboard Shortcuts:</strong> Extensive shortcuts for power users</li>
                  <li><strong>API Access:</strong> Build custom integrations and automations</li>
                </ul>
              </div>
            )}

            {activeTab === 'getting-started' && (
              <div>
                <h3>Getting Started with Zea.Play</h3>

                <h4>1. Account Setup</h4>
                <ol>
                  <li>Visit the login page and enter your email and password</li>
                  <li>If you don't have an account, contact your team administrator</li>
                  <li>Set up your profile with a display name and avatar</li>
                  <li>Configure your notification preferences</li>
                </ol>

                <h4>2. Your First Tasks</h4>
                <ul>
                  <li><strong>Creating Tasks:</strong>
                    <ul>
                      <li>Click the "New Task" button in any view</li>
                      <li>Fill in title, description, priority, and due date</li>
                      <li>Assign to yourself or team members</li>
                      <li>Add labels and custom fields as needed</li>
                    </ul>
                  </li>
                  <li><strong>Organizing Work:</strong>
                    <ul>
                      <li>Create projects to group related tasks</li>
                      <li>Use tags for cross-project categorization</li>
                      <li>Set up recurring tasks for regular work</li>
                      <li>Link dependent tasks together</li>
                    </ul>
                  </li>
                </ul>

                <h4>3. Daily Workflow</h4>
                <ol>
                  <li><strong>Morning Check-in:</strong> Review your daily quests and priorities</li>
                  <li><strong>Task Execution:</strong> Work through your highest priority items</li>
                  <li><strong>Progress Updates:</strong> Mark tasks as in progress and complete</li>
                  <li><strong>End of Day:</strong> Review accomplishments and plan for tomorrow</li>
                </ol>

                <h4>4. Team Integration</h4>
                <ul>
                  <li>Join existing projects or create new ones</li>
                  <li>Participate in team stand-ups and discussions</li>
                  <li>Share progress updates and blockers</li>
                  <li>Collaborate on tasks through comments and attachments</li>
                </ul>

                <h4>5. Building Habits</h4>
                <ul>
                  <li>Maintain daily login streaks for bonus XP</li>
                  <li>Complete daily quests to unlock achievements</li>
                  <li>Review your productivity analytics weekly</li>
                  <li>Customize your workspace to match your preferences</li>
                </ul>

                <h4>Pro Tips</h4>
                <ul>
                  <li>Use keyboard shortcuts (Ctrl/Cmd + /) to see available shortcuts</li>
                  <li>Set up recurring tasks for regular meetings and reviews</li>
                  <li>Create task templates for common work patterns</li>
                  <li>Use the calendar view to plan your week ahead</li>
                  <li>Enable notifications for important deadlines</li>
                </ul>
              </div>
            )}

            {activeTab === 'faq' && (
              <div>
                <h3>Frequently Asked Questions</h3>

                <h4>Account & Access</h4>
                <div>
                  <h5>How do I reset my password?</h5>
                  <p>Click 'Forgot your password?' on the login page and follow the instructions sent to your email.</p>

                  <h5>Can I use Zea.Play without gamification features?</h5>
                  <p>Yes, you can disable gamification elements in your settings if preferred, though we recommend trying them out!</p>

                  <h5>Is my data secure?</h5>
                  <p>Absolutely. We use industry-standard encryption and security practices to protect your data.</p>
                </div>

                <h4>Task Management</h4>
                <div>
                  <h5>How do I create recurring tasks?</h5>
                  <p>When creating a task, check the 'Recurring' option and set the frequency (daily, weekly, monthly).</p>

                  <h5>Can I assign tasks to multiple people?</h5>
                  <p>Currently, tasks can only have one assignee, but you can add multiple collaborators who can comment and track progress.</p>

                  <h5>How do I prioritize tasks?</h5>
                  <p>Use the priority flags (High, Medium, Low) or drag tasks to reorder them in your list view.</p>
                </div>

                <h4>Team Features</h4>
                <div>
                  <h5>How do I invite team members?</h5>
                  <p>Go to Settings {'>'} Team {'>'} Invite Members and enter their email addresses.</p>

                  <h5>Can I create private tasks?</h5>
                  <p>Yes, you can set task visibility to private, or create personal projects that only you can access.</p>

                  <h5>How do notifications work?</h5>
                  <p>You can configure notifications for task assignments, due dates, comments, and team activity in your settings.</p>
                </div>

                <h4>Gamification</h4>
                <div>
                  <h5>What are daily quests?</h5>
                  <p>Daily quests are automatically generated challenges like 'Complete 3 tasks' or 'Log in for 5 consecutive days.'</p>

                  <h5>How do I earn XP?</h5>
                  <p>You earn XP for completing tasks, maintaining streaks, unlocking achievements, and participating in team activities.</p>

                  <h5>Can I reset my progress?</h5>
                  <p>Progress resets are not available, but you can always start fresh with new goals and habits.</p>
                </div>

                <h4>Technical Questions</h4>
                <div>
                  <h5>Which browsers are supported?</h5>
                  <p>Zea.Play works best in modern browsers: Chrome, Firefox, Safari, and Edge (latest versions).</p>

                  <h5>Is there a mobile app?</h5>
                  <p>Mobile apps are in development. For now, use the responsive web interface on your mobile device.</p>

                  <h5>How do I export my data?</h5>
                  <p>Go to Settings {'>'} Data Export to download your tasks, projects, and analytics in various formats.</p>
                </div>

                <h4>Getting Help</h4>
                <p>
                  If you can't find the answer here, try:
                </p>
                <ul>
                  <li>Checking the in-app help tooltips (hover over ? icons)</li>
                  <li>Searching our knowledge base at help.zea.play</li>
                  <li>Contacting support at support@zea.play</li>
                  <li>Joining our community forum for user discussions</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginDocumentationModal;
