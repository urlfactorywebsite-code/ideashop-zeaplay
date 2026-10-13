import React from 'react';
import { KanbanNote, Task } from '../types';
import { ClipboardDocumentListIcon, PlusIcon } from './icons';

interface NotesboardProps {
    notes: KanbanNote[];
    tasks: Task[];
    isAddingNote: boolean;
    newNoteTitle: string;
    newNoteBody: string;
    selectedTaskForNote: string | null;
    resolvedTheme: 'dark' | 'light' | 'colorful';
    heroSurface: string;
    onAddNoteClick: () => void;
    onTitleChange: (value: string) => void;
    onBodyChange: (value: string) => void;
    onTaskSelect: (taskId: string | null) => void;
    onCancelNote: () => void;
    onSaveNote: () => void;
    onUpdateNote: (id: string, updates: Partial<KanbanNote>) => void;
    onDeleteNote: (id: string) => void;
}

const NotesBoard: React.FC<NotesboardProps> = ({
    notes,
    tasks,
    isAddingNote,
    newNoteTitle,
    newNoteBody,
    selectedTaskForNote,
    resolvedTheme,
    heroSurface,
    onAddNoteClick,
    onTitleChange,
    onBodyChange,
    onTaskSelect,
    onCancelNote,
    onSaveNote,
    onUpdateNote,
    onDeleteNote,
}) => {
    return (
        <section className="pt-6 px-6">
            <div className={`rounded-3xl border ${heroSurface} p-8 shadow-lg transition-all duration-300 hover:shadow-xl relative overflow-hidden backdrop-blur-sm`}>
                {/* Decorative background */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/10 opacity-50"></div>
                
                {/* Content */}
                <div className="relative z-10">
                    {/* Header */}
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h2 className={`text-2xl font-bold ${resolvedTheme === 'dark' ? 'text-white' : resolvedTheme === 'colorful' ? 'text-primary-900' : 'text-gray-900'} flex items-center gap-3`}>
                                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl ${resolvedTheme === 'dark' ? 'bg-primary/20' : resolvedTheme === 'colorful' ? 'bg-primary/10' : 'bg-primary/5'}`}>
                                    <ClipboardDocumentListIcon className="w-6 h-6 text-primary" />
                                </span>
                                Notes Board
                            </h2>
                            <p className={`mt-2 text-sm ${resolvedTheme === 'dark' ? 'text-white/60' : resolvedTheme === 'colorful' ? 'text-primary-700' : 'text-gray-600'}`}>
                                Create and manage notes for your tasks
                            </p>
                        </div>
                        <button
                            onClick={onAddNoteClick}
                            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${resolvedTheme === 'dark' ? 'bg-primary text-white hover:bg-primary/90' : resolvedTheme === 'colorful' ? 'bg-primary/10 text-primary-900 hover:bg-primary/20' : 'bg-primary/5 text-primary-700 hover:bg-primary/10'} shadow-lg hover:shadow-xl`}
                        >
                            <PlusIcon className="h-5 w-5" />
                            Add Note
                        </button>
                    </div>

                    {/* Add Note Form */}
                    {isAddingNote && (
                        <div className={`mb-6 rounded-2xl border ${resolvedTheme === 'dark' ? 'border-white/10 bg-white/5' : resolvedTheme === 'colorful' ? 'border-primary/20 bg-white/10' : 'border-gray-200 bg-white'} p-6 backdrop-blur-sm shadow-lg transition-all duration-300`}>
                            <input
                                type="text"
                                value={newNoteTitle}
                                onChange={(e) => onTitleChange(e.target.value)}
                                placeholder="Note Title"
                                className={`mb-4 w-full rounded-xl border ${resolvedTheme === 'dark' ? 'border-white/10 bg-surface/40 text-white placeholder-white/30' : resolvedTheme === 'colorful' ? 'border-primary/20 bg-white/20 text-primary-900 placeholder-primary-400' : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400'} px-4 py-3 text-lg font-medium transition-all duration-300 focus:border-primary focus:ring-2 focus:ring-primary/20`}
                            />
                            <textarea
                                value={newNoteBody}
                                onChange={(e) => onBodyChange(e.target.value)}
                                placeholder="Note Content"
                                className={`mb-4 w-full rounded-xl border ${resolvedTheme === 'dark' ? 'border-white/10 bg-surface/40 text-white placeholder-white/30' : resolvedTheme === 'colorful' ? 'border-primary/20 bg-white/20 text-primary-900 placeholder-primary-400' : 'border-gray-200 bg-white text-gray-900 placeholder-gray-400'} px-4 py-3 transition-all duration-300 focus:border-primary focus:ring-2 focus:ring-primary/20`}
                                rows={4}
                            />
                            <div className="mb-4 space-y-2">
                                <label className={`block text-sm font-semibold ${resolvedTheme === 'dark' ? 'text-white/70' : resolvedTheme === 'colorful' ? 'text-primary-700' : 'text-gray-700'}`}>
                                    Link to Task (Optional)
                                </label>
                                <select
                                    value={selectedTaskForNote || ''}
                                    onChange={(e) => onTaskSelect(e.target.value || null)}
                                    className={`w-full rounded-xl border ${resolvedTheme === 'dark' ? 'border-white/10 bg-surface/40 text-white' : resolvedTheme === 'colorful' ? 'border-primary/20 bg-white/20 text-primary-900' : 'border-gray-200 bg-white text-gray-900'} px-4 py-3 transition-all duration-300 focus:border-primary focus:ring-2 focus:ring-primary/20`}
                                >
                                    <option value="">Select a task...</option>
                                    {tasks.map((task) => (
                                        <option key={task.id} value={task.id}>
                                            {task.title}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={onCancelNote}
                                    className={`rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-300 ${resolvedTheme === 'dark' ? 'border border-white/10 text-white/70 hover:bg-white/10' : resolvedTheme === 'colorful' ? 'border border-primary/20 text-primary-700 hover:bg-primary/10' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={onSaveNote}
                                    className={`rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-300 ${!newNoteTitle.trim() ? 'opacity-50 cursor-not-allowed' : ''} ${resolvedTheme === 'dark' ? 'bg-primary text-white hover:bg-primary/90' : resolvedTheme === 'colorful' ? 'bg-primary/20 text-primary-900 hover:bg-primary/30' : 'bg-primary text-white hover:bg-primary/90'}`}
                                    disabled={!newNoteTitle.trim()}
                                >
                                    Save Note
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Notes Grid */}
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                        {notes.map((note) => (
                            <KanbanNoteCard
                                key={note.id}
                                note={note}
                                onUpdate={onUpdateNote}
                                onDelete={onDeleteNote}
                                resolvedTheme={resolvedTheme}
                                tasks={tasks}
                            />
                        ))}
                        {notes.length === 0 && !isAddingNote && (
                            <div className={`col-span-full flex flex-col items-center justify-center rounded-2xl border ${resolvedTheme === 'dark' ? 'border-white/10 bg-white/5' : resolvedTheme === 'colorful' ? 'border-primary/20 bg-white/10' : 'border-gray-200 bg-white/50'} p-8 text-center`}>
                                <ClipboardDocumentListIcon className={`h-12 w-12 ${resolvedTheme === 'dark' ? 'text-white/30' : resolvedTheme === 'colorful' ? 'text-primary/40' : 'text-gray-400'}`} />
                                <p className={`mt-4 text-lg font-medium ${resolvedTheme === 'dark' ? 'text-white/70' : resolvedTheme === 'colorful' ? 'text-primary-700' : 'text-gray-600'}`}>
                                    No notes yet
                                </p>
                                <p className={`mt-2 text-sm ${resolvedTheme === 'dark' ? 'text-white/50' : resolvedTheme === 'colorful' ? 'text-primary-600' : 'text-gray-500'}`}>
                                    Create your first note to get started
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default NotesBoard;