import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { Level } from '../types';
import CreateLevelModal from '../components/CreateLevelModal';
import PageLoader from '../components/loading/PageLoader';

const LevelsPage: React.FC = () => {
  const [levels, setLevels] = useState<Level[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const loadLevels = async () => {
    try {
      setIsLoading(true);
      const data = await api.getLevels();
      setLevels(data.sort((a, b) => a.levelNumber - b.levelNumber));
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load levels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadLevels();
  }, []);

  const handleDeleteLevel = async (levelId: string) => {
    if (!window.confirm('Are you sure you want to delete this level?')) {
      return;
    }

    try {
      await api.deleteLevel(levelId);
      await loadLevels();
    } catch (err: any) {
      setError(err.message || 'Failed to delete level');
    }
  };

  if (isLoading) {
    return <PageLoader />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Level Management</h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          Create Level
        </button>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {levels.map((level) => (
          <div
            key={level.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {level.name}
              </h3>
              {level.iconUrl && (
                <img
                  src={level.iconUrl}
                  alt="Level Icon"
                  className="w-8 h-8 object-contain"
                />
              )}
            </div>
            
            <div className="space-y-2">
              <p className="text-gray-600 dark:text-gray-300">Level {level.levelNumber}</p>
              <p className="text-gray-600 dark:text-gray-300">{level.description}</p>
              <p className="text-gray-600 dark:text-gray-300">
                Points Required: <span className="font-semibold">{level.pointsRequired}</span>
              </p>
              {level.rewardId && (
                <p className="text-gray-600 dark:text-gray-300">
                  Has Reward: <span className="text-indigo-600">Yes</span>
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end space-x-2">
              <button
                onClick={() => handleDeleteLevel(level.id)}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <CreateLevelModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onLevelCreated={() => {
          loadLevels();
          setIsCreateModalOpen(false);
        }}
      />
    </div>
  );
};

export default LevelsPage;

