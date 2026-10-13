import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';

const levelSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  level_number: z.number().min(1, 'Level number must be at least 1'),
  points_required: z.number().min(0, 'Points required must be at least 0'),
  description: z.string(),
  icon_url: z.string().optional(),
  reward_id: z.string().optional(),
});

interface CreateLevelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLevelCreated: () => void;
}

const CreateLevelModal: React.FC<CreateLevelModalProps> = ({ isOpen, onClose, onLevelCreated }) => {
  const { user: currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [rewards, setRewards] = useState<{ id: string; title: string }[]>([]);

  const { register, handleSubmit, formState: { errors }, reset } = useForm<z.infer<typeof levelSchema>>({
    resolver: zodResolver(levelSchema),
    defaultValues: {
      level_number: 1,
      points_required: 0,
      description: '',
    },
  });

  useEffect(() => {
    // Load available rewards for the dropdown
    const loadRewards = async () => {
      try {
        const data = await api.getRewards();
        setRewards(data.map(reward => ({ id: reward.id, title: reward.title })));
      } catch (err: any) {
        console.error('Failed to load rewards:', err);
      }
    };
    
    if (isOpen) {
      loadRewards();
    }
  }, [isOpen]);

  const handleClose = () => {
    reset();
    setError('');
    onClose();
  };

  const onSubmit = async (data: z.infer<typeof levelSchema>) => {
    if (!currentUser) {
      setError('Authentication error.');
      return;
    }
    setIsSubmitting(true);
    setError('');

    try {
      await api.createLevel({
        name: data.name,
        level_number: data.level_number,
        points_required: data.points_required,
        description: data.description,
        icon_url: data.icon_url,
        reward_id: data.reward_id,
      });
      onLevelCreated();
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create level.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md border border-gray-200 dark:border-gray-700">
        <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">Add New Level</h2>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="name">
              Level Name
            </label>
            <input
              type="text"
              id="name"
              {...register("name")}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {errors.name && (
              <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="level_number">
              Level Number
            </label>
            <input
              type="number"
              id="level_number"
              {...register("level_number", { valueAsNumber: true })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {errors.level_number && (
              <p className="mt-1 text-sm text-red-600">{errors.level_number.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="points_required">
              Points Required
            </label>
            <input
              type="number"
              id="points_required"
              {...register("points_required", { valueAsNumber: true })}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {errors.points_required && (
              <p className="mt-1 text-sm text-red-600">{errors.points_required.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="description">
              Description
            </label>
            <textarea
              id="description"
              {...register("description")}
              rows={3}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {errors.description && (
              <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="icon_url">
              Icon URL
            </label>
            <input
              type="text"
              id="icon_url"
              {...register("icon_url")}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            {errors.icon_url && (
              <p className="mt-1 text-sm text-red-600">{errors.icon_url.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="reward_id">
              Level Reward
            </label>
            <select
              id="reward_id"
              {...register("reward_id")}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="">Select a reward</option>
              {rewards.map(reward => (
                <option key={reward.id} value={reward.id}>
                  {reward.title}
                </option>
              ))}
            </select>
            {errors.reward_id && (
              <p className="mt-1 text-sm text-red-600">{errors.reward_id.message}</p>
            )}
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <div className="flex justify-end space-x-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="py-2 px-4 bg-gray-600 text-white rounded-md hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="py-2 px-4 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add Level'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateLevelModal;