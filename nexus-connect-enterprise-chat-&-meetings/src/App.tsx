import React from 'react';
import { AuthProvider } from './context/AuthContext';
import { ChatProvider } from './context/ChatContext';
import { CallProvider } from './context/CallContext';
import { AppLayout } from './components/layout/AppLayout';

export default function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <CallProvider>
          <AppLayout />
        </CallProvider>
      </ChatProvider>
    </AuthProvider>
  );
}
