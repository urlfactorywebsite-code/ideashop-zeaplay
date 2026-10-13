import React from 'react';
import { XMarkIcon } from './icons';

interface ProfileDocumentationModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const ProfileDocumentationModal: React.FC<ProfileDocumentationModalProps> = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = React.useState('profile');

    if (!isOpen) return null;

    const tabs = [
        { id: 'profile', label: 'Profile', content: (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-blue-400">Profile Information</h3>
                <p className="text-sm text-gray-300">Manage your personal details including name, department, and role. Your profile information is used across the application for personalization and access control.</p>
                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                    <li><strong>Full Name:</strong> Your display name visible to other users.</li>
                    <li><strong>Email:</strong> Your login email, cannot be changed here.</li>
                    <li><strong>Department:</strong> Select from available departments for organization.</li>
                    <li><strong>Role:</strong> Your permission level (User, Admin, Owner).</li>
                </ul>
                <p className="text-sm text-gray-300">Changes are saved immediately and reflected across the app.</p>
            </div>
        )},
        { id: 'achievements', label: 'Achievements', content: (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-green-400">Achievements</h3>
                <p className="text-sm text-gray-300">Track your progress and unlock badges by completing tasks and milestones. Achievements gamify your productivity journey.</p>
                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                    <li><strong>Task Master:</strong> Complete 10 tasks.</li>
                    <li><strong>Speed Demon:</strong> Finish a task in under 1 hour.</li>
                    <li><strong>Team Player:</strong> Collaborate on 5 team tasks.</li>
                    <li><strong>Streak King:</strong> Complete tasks for 7 consecutive days.</li>
                </ul>
                <p className="text-sm text-gray-300">Earn rewards and recognition for your accomplishments!</p>
            </div>
        )},
        { id: 'stats', label: 'Statistics', content: (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-purple-400">User Statistics</h3>
                <p className="text-sm text-gray-300">View detailed analytics about your task management performance and productivity metrics.</p>
                <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
                    <li><strong>Tasks Completed:</strong> Total number of finished tasks.</li>
                    <li><strong>Average Completion Time:</strong> How quickly you finish tasks on average.</li>
                    <li><strong>Productivity Score:</strong> Overall efficiency rating based on various factors.</li>
                    <li><strong>Current Streak:</strong> Consecutive days with completed tasks.</li>
                    <li><strong>Department Ranking:</strong> Your position among department members.</li>
                </ul>
                <p className="text-sm text-gray-300">Use these insights to improve your workflow and set new goals.</p>
            </div>
        )},
        { id: 'admin', label: 'Admin Settings', content: (
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-red-400">Administrative Settings</h3>
                <p className="text-sm text-gray-300">Configure system-wide settings, integrations, and data management. These features are only available to Admin and Owner roles.</p>
                <div className="space-y-3">
                    <div>
                        <h4 className="font-medium text-orange-400">API Configuration</h4>
                        <p className="text-sm text-gray-300">Set up AI integration for enhanced features like task insights and smart suggestions.</p>
                        <ul className="list-disc list-inside text-sm text-gray-300 ml-4">
                            <li>Choose from various LLM providers (Google Gemini, OpenAI, etc.)</li>
                            <li>Securely store API keys for AI-powered features</li>
                            <li>Enable intelligent task analysis and recommendations</li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="font-medium text-orange-400">SMTP Configuration</h4>
                        <p className="text-sm text-gray-300">Configure email settings for notifications and system communications.</p>
                        <ul className="list-disc list-inside text-sm text-gray-300 ml-4">
                            <li>Set up SMTP server for sending emails</li>
                            <li>Configure host, port, encryption, and credentials</li>
                            <li>Enable automated notifications and alerts</li>
                        </ul>
                    </div>
                    <div>
                        <h4 className="font-medium text-orange-400">Data Management</h4>
                        <p className="text-sm text-gray-300">Backup, restore, and manage application data.</p>
                        <ul className="list-disc list-inside text-sm text-gray-300 ml-4">
                            <li>Export data in JSON format for backup</li>
                            <li>Import data from previous backups</li>
                            <li>Perform full system reset with verification</li>
                        </ul>
                    </div>
                </div>
            </div>
        )},
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-gradient-to-br from-blue-900 to-purple-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
                <div className="flex items-center justify-between p-6 border-b border-gray-700">
                    <h2 className="text-2xl font-bold text-white">Profile Documentation</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <XMarkIcon className="h-6 w-6" />
                    </button>
                </div>
                <div className="flex border-b border-gray-700">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-6 py-3 font-medium transition-colors ${
                                activeTab === tab.id
                                    ? 'text-white border-b-2 border-blue-400 bg-blue-800/20'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800/20'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="p-6 overflow-y-auto max-h-[60vh]">
                    {tabs.find(tab => tab.id === activeTab)?.content}
                </div>
            </div>
        </div>
    );
};

export default ProfileDocumentationModal;
