import React, { useState, useEffect, useRef } from 'react';
import { ChatBubbleOvalLeftEllipsisIcon, XMarkIcon, PaperAirplaneIcon } from './icons';
import { BOT_ERROR_MESSAGE, generateSessionId, sendAiMessage } from '../utils/aiClient';

type BotChatMessage = {
    sender: 'bot' | 'user';
    text: string;
};

const Chatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<BotChatMessage[]>([
        { sender: 'bot', text: "Hello! I'm your AI assistant. How can I help you manage your tasks today?" }
    ]);
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId] = useState(generateSessionId());
    const messagesEndRef = useRef<null | HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages, isLoading]);

    const handleSendMessage = async () => {
        if (!userInput.trim()) return;

        const newUserMessage: BotChatMessage = { sender: 'user', text: userInput };
        setMessages(prev => [...prev, newUserMessage]);
        const currentInput = userInput;
        setUserInput('');
        setIsLoading(true);

        try {
            const botReply = await sendAiMessage({
                message: currentInput,
                sessionId,
            });

            const newBotMessage: BotChatMessage = { sender: 'bot', text: botReply };
            setMessages(prev => [...prev, newBotMessage]);
        } catch (error) {
            console.error('Error communicating with the chatbot webhook:', error);
            const errorMessage: BotChatMessage = { sender: 'bot', text: BOT_ERROR_MESSAGE };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !isLoading) {
            handleSendMessage();
        }
    };

    return (
        <>
            {/* Chat Widget */}
            <div className={`fixed bottom-24 right-6 w-96 bg-surface border border-border-color rounded-lg shadow-xl z-30 flex flex-col transition-all duration-300 ease-in-out ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`} style={{height: '60vh'}}>
                {/* Header */}
                <div className="flex-shrink-0 flex justify-between items-center p-3 border-b border-border-color">
                    <h3 className="font-bold text-text-primary">AI Assistant</h3>
                    <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
                        <XMarkIcon className="h-6 w-6" />
                    </button>
                </div>

                {/* Messages */}
                <div className="flex-1 p-4 overflow-y-auto">
                    <div className="space-y-4">
                        {messages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${msg.sender === 'user' ? 'bg-primary text-white' : 'bg-background'}`}>
                                    <p className="text-sm break-words">{msg.text}</p>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-background px-4 py-2 rounded-lg">
                                    <div className="flex items-center space-x-1">
                                        <span className="h-2 w-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.3s]"></span>
                                        <span className="h-2 w-2 bg-gray-400 rounded-full animate-pulse [animation-delay:-0.15s]"></span>
                                        <span className="h-2 w-2 bg-gray-400 rounded-full animate-pulse"></span>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Input */}
                <div className="flex-shrink-0 p-3 border-t border-border-color flex items-center">
                    <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Type a message..."
                        className="flex-1 bg-background border border-border-color rounded-l-md py-2 px-3 focus:outline-none focus:ring-1 focus:ring-primary text-sm"
                        disabled={isLoading}
                    />
                    <button onClick={handleSendMessage} disabled={isLoading || !userInput.trim()} className="bg-primary text-white p-2.5 rounded-r-md disabled:opacity-50">
                        <PaperAirplaneIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* FAB */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="chatbot-fab fixed bottom-6 right-6 flex items-center justify-center bg-transparent p-1 text-white z-30 transition-transform hover:scale-110"
                aria-label="Toggle AI Assistant"
            >
                <img
                    src="https://res.cloudinary.com/dqhcbck76/image/upload/v1770241421/chatbot_m60ya9.png"
                    alt="Chatbot"
                    className="h-14 w-14 object-contain"
                />
            </button>
        </>
    );
};
export default Chatbot;





