import React, { useState } from 'react';
import { XMarkIcon } from './icons';

interface KanbanDocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const KanbanDocumentationModal: React.FC<KanbanDocumentationModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState('overview');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border-color">
          <h2 className="text-xl font-semibold text-text-primary">Kanban Board Documentation</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-4 overflow-hidden flex flex-col h-[calc(90vh-4rem)]">
          {/* Tabs */}
          <div className="flex space-x-4 mb-4 border-b border-border-color">
            <button
              className={`pb-2 px-4 ${
                activeTab === 'overview'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`pb-2 px-4 ${
                activeTab === 'features'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('features')}
            >
              Features & Tools
            </button>
            <button
              className={`pb-2 px-4 ${
                activeTab === 'howto'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('howto')}
            >
              How to Use
            </button>
            <button
              className={`pb-2 px-4 ${
                activeTab === 'tips'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('tips')}
            >
              Tips & Best Practices
            </button>
            <button
              className={`pb-2 px-4 ${
                activeTab === 'shortcuts'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary'
              }`}
              onClick={() => setActiveTab('shortcuts')}
            >
              Keyboard Shortcuts
            </button>
          </div>

          {/* Tab Content */}
          <div className="overflow-y-auto flex-1 prose prose-sm max-w-none text-text-primary">
            {activeTab === 'overview' && (
              <div>
                <h3>What is the Kanban Board?</h3>
                <p>
                  The Kanban Board is a visual task management tool that helps you and your team visualize work, 
                  limit work-in-progress, and maximize efficiency. It's based on the Kanban methodology, which 
                  originated in Toyota's manufacturing processes and has been adapted for knowledge work.
                </p>

                <h4>Core Principles</h4>
                <ul>
                  <li><strong>Visualize Work:</strong> All work items are represented as cards on the board</li>
                  <li><strong>Limit Work in Progress:</strong> Focus on completing tasks before starting new ones</li>
                  <li><strong>Manage Flow:</strong> Monitor and optimize the flow of work through the system</li>
                  <li><strong>Make Process Explicit:</strong> Clear stages and policies for work movement</li>
                </ul>

                <h4>Board Structure</h4>
                <ul>
                  <li><strong>Columns:</strong> Represent different stages in your workflow</li>
                  <li><strong>Cards:</strong> Individual tasks or work items</li>
                  <li><strong>Swimlanes:</strong> Horizontal categorization of work (optional)</li>
                  <li><strong>WIP Limits:</strong> Restrictions on tasks per column</li>
                </ul>

                <h4>Benefits</h4>
                <ul>
                  <li>Improved visibility of work status and bottlenecks</li>
                  <li>Better work organization and prioritization</li>
                  <li>Enhanced team collaboration and communication</li>
                  <li>Reduced time waste and increased productivity</li>
                  <li>Flexible adaptation to changing priorities</li>
                </ul>
              </div>
            )}

            {activeTab === 'features' && (
              <div>
                <h3>Features & Tools</h3>
                
                <h4>Board Management</h4>
                <ul>
                  <li><strong>Custom Columns:</strong>
                    <ul>
                      <li>Create and name custom columns</li>
                      <li>Set WIP limits for each column</li>
                      <li>Rearrange columns via drag-and-drop</li>
                      <li>Collapse/expand columns for better focus</li>
                    </ul>
                  </li>
                  <li><strong>Card Management:</strong>
                    <ul>
                      <li>Create new task cards</li>
                      <li>Set priorities and deadlines</li>
                      <li>Assign team members</li>
                      <li>Add labels and tags</li>
                      <li>Attach files and links</li>
                    </ul>
                  </li>
                  <li><strong>Filtering & Search:</strong>
                    <ul>
                      <li>Filter by assignee, label, or priority</li>
                      <li>Search across all cards</li>
                      <li>Save custom filters</li>
                      <li>Quick filters for my tasks</li>
                    </ul>
                  </li>
                </ul>

                <h4>Visualization Tools</h4>
                <ul>
                  <li><strong>Card Colors:</strong> Visual indicators for priority/status</li>
                  <li><strong>Progress Bars:</strong> Task completion tracking</li>
                  <li><strong>Due Date Indicators:</strong> Visual deadline reminders</li>
                  <li><strong>Member Avatars:</strong> Quick assignee identification</li>
                </ul>

                <h4>Collaboration Features</h4>
                <ul>
                  <li><strong>Comments & Discussions:</strong> 
                    <ul>
                      <li>Comment threads on cards</li>
                      <li>@mentions for team members</li>
                      <li>File attachments in comments</li>
                    </ul>
                  </li>
                  <li><strong>Activity Tracking:</strong>
                    <ul>
                      <li>Card movement history</li>
                      <li>Edit history</li>
                      <li>Comment history</li>
                    </ul>
                  </li>
                </ul>

                <h4>Analytics & Reporting</h4>
                <ul>
                  <li>Cumulative flow diagrams</li>
                  <li>Cycle time metrics</li>
                  <li>Throughput analysis</li>
                  <li>Team performance insights</li>
                </ul>
              </div>
            )}

            {activeTab === 'howto' && (
              <div>
                <h3>How to Use the Kanban Board</h3>

                <h4>1. Setting Up Your Board</h4>
                <ol>
                  <li><strong>Create Columns:</strong>
                    <ul>
                      <li>Click the "+" button in the board header</li>
                      <li>Name your column (e.g., "To Do", "In Progress", "Done")</li>
                      <li>Set WIP limits if desired</li>
                      <li>Arrange columns in workflow order</li>
                    </ul>
                  </li>
                  <li><strong>Configure Card Templates:</strong>
                    <ul>
                      <li>Set up default fields</li>
                      <li>Create custom fields if needed</li>
                      <li>Define required information</li>
                    </ul>
                  </li>
                </ol>

                <h4>2. Creating and Managing Cards</h4>
                <ol>
                  <li><strong>Create New Cards:</strong>
                    <ul>
                      <li>Click "+" in any column</li>
                      <li>Fill in task details</li>
                      <li>Add descriptions and attachments</li>
                      <li>Assign team members</li>
                    </ul>
                  </li>
                  <li><strong>Moving Cards:</strong>
                    <ul>
                      <li>Drag and drop between columns</li>
                      <li>Use keyboard shortcuts</li>
                      <li>Respect WIP limits</li>
                    </ul>
                  </li>
                </ol>

                <h4>3. Collaboration</h4>
                <ol>
                  <li><strong>Working with Team Members:</strong>
                    <ul>
                      <li>Assign cards to team members</li>
                      <li>Add comments and feedback</li>
                      <li>Use @mentions for notifications</li>
                      <li>Share updates and progress</li>
                    </ul>
                  </li>
                  <li><strong>Communication:</strong>
                    <ul>
                      <li>Update card status regularly</li>
                      <li>Document decisions in comments</li>
                      <li>Use labels for clear categorization</li>
                    </ul>
                  </li>
                </ol>

                <h4>4. Monitoring and Analysis</h4>
                <ul>
                  <li>Review board metrics regularly</li>
                  <li>Check for bottlenecks</li>
                  <li>Analyze team performance</li>
                  <li>Make process adjustments as needed</li>
                </ul>
              </div>
            )}

            {activeTab === 'tips' && (
              <div>
                <h3>Tips & Best Practices</h3>

                <h4>Board Organization</h4>
                <ul>
                  <li><strong>Keep It Simple:</strong>
                    <ul>
                      <li>Start with basic columns (To Do, In Progress, Done)</li>
                      <li>Add columns only when necessary</li>
                      <li>Use clear, consistent naming conventions</li>
                    </ul>
                  </li>
                  <li><strong>Maintain Card Hygiene:</strong>
                    <ul>
                      <li>Keep descriptions clear and concise</li>
                      <li>Regularly update card status</li>
                      <li>Archive completed cards periodically</li>
                      <li>Use templates for consistency</li>
                    </ul>
                  </li>
                </ul>

                <h4>Workflow Management</h4>
                <ul>
                  <li><strong>WIP Limits:</strong>
                    <ul>
                      <li>Set realistic limits for each column</li>
                      <li>Monitor and adjust limits as needed</li>
                      <li>Address bottlenecks promptly</li>
                    </ul>
                  </li>
                  <li><strong>Flow Optimization:</strong>
                    <ul>
                      <li>Focus on completing tasks before starting new ones</li>
                      <li>Identify and remove process blockers</li>
                      <li>Regular board reviews and cleanup</li>
                    </ul>
                  </li>
                </ul>

                <h4>Team Collaboration</h4>
                <ul>
                  <li><strong>Communication:</strong>
                    <ul>
                      <li>Use clear and specific card titles</li>
                      <li>Keep comments focused and actionable</li>
                      <li>Update progress regularly</li>
                    </ul>
                  </li>
                  <li><strong>Task Assignment:</strong>
                    <ul>
                      <li>Balance workload across team members</li>
                      <li>Consider skill sets when assigning tasks</li>
                      <li>Rotate responsibilities when possible</li>
                    </ul>
                  </li>
                </ul>

                <h4>Continuous Improvement</h4>
                <ul>
                  <li>Hold regular team retrospectives</li>
                  <li>Gather feedback on board usage</li>
                  <li>Adjust processes based on metrics</li>
                  <li>Stay updated on new features</li>
                </ul>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div>
                <h3>Keyboard Shortcuts</h3>

                <h4>Navigation</h4>
                <ul>
                  <li><kbd>→</kbd> Move focus to next column</li>
                  <li><kbd>←</kbd> Move focus to previous column</li>
                  <li><kbd>↑</kbd> Move focus to card above</li>
                  <li><kbd>↓</kbd> Move focus to card below</li>
                  <li><kbd>Home</kbd> Jump to first column</li>
                  <li><kbd>End</kbd> Jump to last column</li>
                </ul>

                <h4>Card Actions</h4>
                <ul>
                  <li><kbd>N</kbd> Create new card</li>
                  <li><kbd>E</kbd> Edit focused card</li>
                  <li><kbd>Space</kbd> Open card details</li>
                  <li><kbd>Delete</kbd> Archive card</li>
                  <li><kbd>C</kbd> Add comment</li>
                </ul>

                <h4>Board Management</h4>
                <ul>
                  <li><kbd>Ctrl</kbd> + <kbd>F</kbd> Open search</li>
                  <li><kbd>Ctrl</kbd> + <kbd>B</kbd> Toggle board menu</li>
                  <li><kbd>Ctrl</kbd> + <kbd>M</kbd> Toggle minimize column</li>
                  <li><kbd>F5</kbd> Refresh board</li>
                </ul>

                <h4>View Options</h4>
                <ul>
                  <li><kbd>1</kbd> Switch to compact view</li>
                  <li><kbd>2</kbd> Switch to detailed view</li>
                  <li><kbd>3</kbd> Toggle card numbers</li>
                  <li><kbd>4</kbd> Toggle assignee avatars</li>
                </ul>

                <h4>Pro Tips</h4>
                <ul>
                  <li>Hold <kbd>Shift</kbd> while dragging to move multiple cards</li>
                  <li>Double-click column header to rename</li>
                  <li>Press <kbd>?</kbd> to show/hide this shortcuts guide</li>
                  <li>Use <kbd>Esc</kbd> to close any modal or popup</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default KanbanDocumentationModal;