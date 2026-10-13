import React, { useMemo, useState } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { TaskPriority } from '../types';
import { withGeminiKey } from '../utils/geminiClient';
import { SparklesIcon } from './icons';

interface GenerateTaskWithAIModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskGenerated: (data: { title: string; description: string; priority: TaskPriority; subtasks?: string[] }) => void;
}

type PromptMode = 'simple' | 'medium' | 'high' | 'detailed';

const PROMPT_MODES: Record<PromptMode, { label: string; description: string; instruction: string }> = {
    simple: {
        label: 'Simple',
        description: 'Short and clear. Focus on the core goal.',
        instruction: 'Keep the title and description concise. Focus on the main action and a single outcome.',
    },
    medium: {
        label: 'Medium',
        description: 'Balanced detail with key context and deliverables.',
        instruction: 'Provide enough detail to execute without extra context. Include goal, scope, deliverables, and success criteria.',
    },
    high: {
        label: 'High',
        description: 'Deep detail with constraints and dependencies.',
        instruction: 'Go deeper on scope, constraints, dependencies, risks, and required inputs. Make the description execution-ready.',
    },
    detailed: {
        label: 'Detail',
        description: 'Step-by-step plan with detailed explanation and subtasks.',
        instruction: 'Provide a detailed explanation and a step-by-step plan. Use numbered steps in the description when helpful.',
    },
};

const MIN_QUESTION_COUNT = 3;
const MAX_QUESTION_COUNT = 7;

const GenerateTaskWithAIModal: React.FC<GenerateTaskWithAIModalProps> = ({ isOpen, onClose, onTaskGenerated }) => {
    const [prompt, setPrompt] = useState('');
    const [promptMode, setPromptMode] = useState<PromptMode>('medium');
    const [askQuestions, setAskQuestions] = useState(false);
    const [questions, setQuestions] = useState<string[]>([]);
    const [answers, setAnswers] = useState<Record<number, string>>({});
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const activePrompt = useMemo(() => PROMPT_MODES[promptMode], [promptMode]);
    const isQuestionStep = askQuestions && questions.length > 0;
    const canGenerateQuestions = askQuestions && !isQuestionStep;
    const generateButtonLabel = canGenerateQuestions ? 'Generate Questions' : 'Generate Task';
    const shouldGenerateSubtasks = promptMode === 'detailed';

    const normalizeQuestions = (input: unknown): string[] => {
        const list = Array.isArray(input) ? input : [];
        const cleaned = list
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0);
        if (cleaned.length >= MIN_QUESTION_COUNT) {
            return cleaned.slice(0, MAX_QUESTION_COUNT);
        }
        return cleaned;
    };

    const buildQuestionPrompt = () => {
        return `User prompt: ${prompt}\n\nGenerate ${MIN_QUESTION_COUNT}-${MAX_QUESTION_COUNT} questions to clarify requirements, scope, timeline, and success criteria.`;
    };

    const buildTaskPrompt = () => {
        const questionBlock = questions
            .map((question, index) => {
                const answer = answers[index] ?? '';
                return `Q${index + 1}: ${question}\nA${index + 1}: ${answer || 'Not answered'}`;
            })
            .join('\n');
        const promptBlock = `User prompt: ${prompt}`;
        const modeBlock = `Prompt mode: ${activePrompt.label}. ${activePrompt.instruction}`;
        return [promptBlock, modeBlock, questionBlock].filter(Boolean).join('\n\n');
    };

    const handleGenerateQuestions = async () => {
        setIsLoading(true);
        setError('');

        try {
            const response = await withGeminiKey(async (apiKey) => {
                const ai = new GoogleGenAI({ apiKey });
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        questions: {
                            type: Type.ARRAY,
                            description: `A list of ${MIN_QUESTION_COUNT}-${MAX_QUESTION_COUNT} questions to clarify the task.`,
                            items: { type: Type.STRING },
                        },
                    },
                    required: ['questions'],
                };
                const systemInstruction = `You are a project planning assistant. Ask ${MIN_QUESTION_COUNT}-${MAX_QUESTION_COUNT} focused questions to clarify requirements and expected outcomes. Return JSON only.`;
                return ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: buildQuestionPrompt(),
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema,
                        systemInstruction,
                    },
                });
            });

            const resultJson = JSON.parse(response.text);
            const nextQuestions = normalizeQuestions(resultJson.questions);
            if (nextQuestions.length < MIN_QUESTION_COUNT) {
                throw new Error('AI did not return enough questions.');
            }
            setQuestions(nextQuestions);
            setAnswers({});
        } catch (err) {
            console.error('Error generating questions with AI:', err);
            const message = err instanceof Error ? err.message : 'Failed to generate questions. Please try again.';
            const displayMessage =
                message.includes('AI features are disabled') || message.includes('Gemini API keys')
                    ? message
                    : 'Failed to generate questions. Please try again.';
            setError(displayMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerateTask = async () => {
        setIsLoading(true);
        setError('');

        try {
            const response = await withGeminiKey(async (apiKey) => {
                const ai = new GoogleGenAI({ apiKey });
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: 'A concise and clear title for the task.' },
                        description: { type: Type.STRING, description: 'A detailed description of the task, including what needs to be done.' },
                        priority: {
                            type: Type.STRING,
                            description: 'The priority of the task. Must be one of: LOW, MEDIUM, HIGH, URGENT.',
                        },
                        ...(shouldGenerateSubtasks
                            ? {
                                  subtasks: {
                                      type: Type.ARRAY,
                                      description: 'A list of subtasks required to complete the task.',
                                      items: { type: Type.STRING },
                                  },
                              }
                            : {}),
                    },
                    required: shouldGenerateSubtasks
                        ? ['title', 'description', 'priority', 'subtasks']
                        : ['title', 'description', 'priority'],
                };

                const systemInstruction = shouldGenerateSubtasks
                    ? `You are an expert project manager assistant. Your task is to analyze the user's prompt and return JSON with title, description, priority, and subtasks. Priority must be one of: LOW, MEDIUM, HIGH, URGENT. ${activePrompt.instruction} Include 3-8 subtasks with short action phrases. Return JSON only.`
                    : `You are an expert project manager assistant. Your task is to analyze the user's prompt and return JSON with title, description, and priority. Priority must be one of: LOW, MEDIUM, HIGH, URGENT. ${activePrompt.instruction} Return JSON only.`;

                return ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: buildTaskPrompt(),
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema,
                        systemInstruction,
                    },
                });
            });

            const resultJson = JSON.parse(response.text);

            const validPriorities = Object.values(TaskPriority);
            const generatedPriority = (resultJson.priority || 'MEDIUM').toUpperCase() as TaskPriority;
            const finalPriority = validPriorities.includes(generatedPriority) ? generatedPriority : TaskPriority.MEDIUM;
            const rawSubtasks = shouldGenerateSubtasks && Array.isArray(resultJson.subtasks) ? resultJson.subtasks : [];
            const subtasks = rawSubtasks
                .map((item: unknown) => String(item).trim())
                .filter((item: string) => item.length > 0);

            onTaskGenerated({
                title: resultJson.title || 'Untitled Task',
                description: resultJson.description || 'No description generated.',
                priority: finalPriority,
                ...(shouldGenerateSubtasks ? { subtasks } : {}),
            });
            onClose();
        } catch (err) {
            console.error('Error generating task with AI:', err);
            const message = err instanceof Error ? err.message : 'Failed to generate task. Please check the prompt or your API key.';
            const displayMessage =
                message.includes('AI features are disabled') || message.includes('Gemini API keys')
                    ? message
                    : 'Failed to generate task. Please check the prompt or your API key.';
            setError(displayMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!prompt.trim()) {
            return;
        }
        if (canGenerateQuestions) {
            await handleGenerateQuestions();
            return;
        }
        await handleGenerateTask();
    };
    
    const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleToggleAskQuestions = (value: boolean) => {
        setAskQuestions(value);
        setQuestions([]);
        setAnswers({});
        setError('');
    };


    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-80 z-[60] flex justify-center items-center p-4" onClick={handleOverlayClick}>
            <div className="bg-surface p-8 rounded-lg shadow-xl w-full max-w-lg border border-border-color max-h-[85vh] overflow-y-auto custom-scrollbar">
                <h2 className="text-2xl font-bold text-text-primary">Generate Task with AI</h2>
                <p className="text-text-secondary mt-1 mb-6">Simply describe what you need, and AI will draft the task for you.</p>

                <div className="space-y-4">
                    <div>
                        <p className="text-sm font-medium text-text-secondary">Feature prompt style</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            {Object.entries(PROMPT_MODES).map(([key, mode]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setPromptMode(key as PromptMode)}
                                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                                        promptMode === key
                                            ? 'border-primary bg-primary/10 text-text-primary'
                                            : 'border-border-color bg-background text-text-secondary hover:border-primary/60'
                                    }`}
                                >
                                    <div className="font-semibold">{mode.label}</div>
                                    <div className="text-xs text-text-secondary">{mode.description}</div>
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-xs text-text-secondary">
                            Detail mode provides step-by-step guidance, a detailed explanation, and subtasks.
                        </p>
                    </div>

                    <div>
                        <label htmlFor="ai-prompt" className="block text-sm font-medium text-text-secondary">Type Your Prompt</label>
                        <textarea
                            id="ai-prompt"
                            rows={5}
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            placeholder="e.g. Draft a blog post about our new feature launch for next Monday. It's a high priority."
                            className="mt-1 block w-full bg-background border border-border-color rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary"
                            disabled={isQuestionStep}
                        />
                        <p className="text-xs text-text-secondary mt-2 flex items-center gap-2">
                            <SparklesIcon className="h-4 w-4 text-primary"/>
                            Be specific about details like purpose, audience, and desired outcome to get the best results.
                        </p>
                    </div>

                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                        <input
                            type="checkbox"
                            checked={askQuestions}
                            onChange={(e) => handleToggleAskQuestions(e.target.checked)}
                            className="h-4 w-4 rounded border-border-color text-primary focus:ring-primary"
                        />
                        Ask 3 to 7 questions before generating the task
                    </label>
                    {askQuestions && !isQuestionStep && (
                        <p className="text-xs text-text-secondary">
                            Step 1: generate questions. Step 2: answer and generate the task and description (subtasks in Detail mode).
                        </p>
                    )}

                    {isQuestionStep && (
                        <div className="rounded-md border border-border-color bg-background/60 p-3">
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-text-primary">Answer these questions</p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setQuestions([]);
                                        setAnswers({});
                                    }}
                                    className="text-xs font-semibold text-primary hover:text-primary-dark"
                                >
                                    Edit prompt
                                </button>
                            </div>
                            <div className="mt-3 space-y-3">
                                {questions.map((question, index) => (
                                    <label key={`${question}-${index}`} className="block text-xs text-text-secondary">
                                        {question}
                                        <input
                                            type="text"
                                            value={answers[index] ?? ''}
                                            onChange={(e) =>
                                                setAnswers((prev) => ({ ...prev, [index]: e.target.value }))
                                            }
                                            className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-primary focus:border-primary"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {error && <p className="text-red-400 my-2 p-3 bg-red-900/50 border border-red-700 rounded-md text-sm">{error}</p>}
                </div>

                <div className="flex justify-end space-x-4 pt-6">
                    <button type="button" onClick={onClose} className="py-2 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700">
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleGenerate}
                        disabled={isLoading || !prompt.trim()}
                        className="py-2 px-4 bg-primary text-white rounded-md hover:bg-primary-dark disabled:opacity-50 flex items-center space-x-2"
                    >
                        <SparklesIcon className="h-5 w-5"/>
                        <span>{isLoading ? 'Generating...' : generateButtonLabel}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GenerateTaskWithAIModal;
