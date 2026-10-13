import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { queryClient } from './services/queryClient';

console.log('index.tsx: Starting React app');

document.addEventListener('DOMContentLoaded', () => {
  console.log('index.tsx: DOMContentLoaded event fired');
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('index.tsx: Could not find root element to mount to');
    throw new Error("Could not find root element to mount to");
  }

  console.log('index.tsx: Creating React root');
  const root = ReactDOM.createRoot(rootElement);
  console.log('index.tsx: Rendering app');
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
  console.log('index.tsx: App rendered successfully');
});
