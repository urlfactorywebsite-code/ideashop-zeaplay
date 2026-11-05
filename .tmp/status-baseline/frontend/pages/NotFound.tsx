
import React from 'react';
import { Link } from 'react-router-dom';

const NotFound: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-background text-text-primary">
      <h1 className="text-6xl font-bold text-primary">404</h1>
      <h2 className="text-2xl font-semibold mt-4 mb-2">Page Not Found</h2>
      <p className="text-text-secondary mb-6">The page you're looking for doesn't exist or has been moved.</p>
      <Link
        to="/"
        className="px-6 py-2 bg-primary text-white rounded-md hover:bg-primary-dark transition"
      >
        Go Home
      </Link>
    </div>
  );
};

export default NotFound;


