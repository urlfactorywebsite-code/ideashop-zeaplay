import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../services/mockApi';
import { User, Department, AvatarAsset } from '../types';
import { useAuth } from '../hooks/useAuth';
import AvatarPicker from './AvatarPicker';
import { useAvatarLibrary } from '../hooks/useAvatarLibrary';
import { FRAME_OPTIONS, getFrameClassName, DEFAULT_FRAME_ID } from '../constants/avatarFrames';
import { getUserAvatarUrl } from '../utils/userAvatar';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onUserUpdated: (newDepartments?: Department[]) => void;
  departments: Department[];
}

const EditUserModal: React.FC<EditUserModalProps> = ({
  isOpen,
  onClose,
  user,
  onUserUpdated,
  departments,
}) => {
  const { user: currentUser } = useAuth();

  const [name, setName] = useState(user.name);
  const [employerId, setEmployerId] = useState(user.employerId || '');
  const [department, setDepartment] = useState(user.department);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { avatars, loading: avatarsLoading } = useAvatarLibrary();
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(user.avatarAssetId ?? null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(getUserAvatarUrl(user) ?? null);
  const [avatarFrame, setAvatarFrame] = useState<string>(user.avatarFrame ?? DEFAULT_FRAME_ID);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    setName(user.name);
    setEmployerId(user.employerId || '');
    setDepartment(user.department);
    setAvatarAssetId(user.avatarAssetId ?? null);
    setAvatarPreview(getUserAvatarUrl(user) ?? null);
    setAvatarFrame(user.avatarFrame ?? DEFAULT_FRAME_ID);
  }, [user]);

  const previewFrameClass = useMemo(() => getFrameClassName(avatarFrame, user.role), [avatarFrame, user.role]);
  const handleSelectAvatar = useCallback((asset: AvatarAsset) => {
    setError('');
    setAvatarAssetId(asset.id);
    setAvatarPreview(asset.url ?? asset.externalUrl ?? null);
  }, []);

  const handleClearAvatar = useCallback(() => {
    setAvatarAssetId(null);
    setAvatarPreview(null);
  }, []);

  const handleCustomAvatarCropped = useCallback(async (dataUrl: string) => {
    try {
      setError('');
      setAvatarUploading(true);
      const updatedUser = await api.uploadUserAvatar(user.id, dataUrl);
      setAvatarAssetId(updatedUser.avatarAssetId ?? null);
      setAvatarPreview(getUserAvatarUrl(updatedUser) ?? dataUrl);
      setAvatarFrame(updatedUser.avatarFrame ?? avatarFrame);
    } catch (uploadError: any) {
      setError(uploadError?.message || 'Failed to update avatar. Please try again.');
    } finally {
      setAvatarUploading(false);
    }
  }, [avatarFrame, user.id]);

  const handleClose = () => {
    setError('');
    setIsSubmitting(false);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) {
      setError('Authentication error.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      let finalDepartment = department;
      let newDepartmentsList;

      if (department === 'add_new') {
        if (!newDepartmentName.trim()) {
          setError('New department name cannot be empty.');
          setIsSubmitting(false);
          return;
        }

        const newDept = await api.addDepartment(newDepartmentName.trim());
        finalDepartment = newDept.name;
        newDepartmentsList = [...departments, newDept];
      }

      await api.updateUser(
        user.id,
        { name, employerId, department: finalDepartment, avatarAssetId, avatarFrame },
        currentUser.id
      );

      onUserUpdated(newDepartmentsList);
      handleClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update user. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-4xl h-full max-h-[90vh] rounded-xl border border-gray-300 bg-white shadow-2xl dark:border-gray-600 dark:bg-gray-800 transition-all duration-300 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-700 flex-shrink-0">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Edit User
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel: Personal Information & Avatar */}
            <div className="flex-1 flex flex-col border-r border-gray-200 dark:border-gray-700">
              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Personal Information Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 border-b border-gray-200 pb-2 dark:border-gray-700">
                    Personal Information
                  </h3>

                  {/* Name */}
                  <div>
                    <label
                      htmlFor="edit-name"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-100"
                    >
                      Full Name
                    </label>
                    <input
                      id="edit-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-white py-3 px-4 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label
                      htmlFor="edit-email"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-100"
                    >
                      Email Address
                    </label>
                    <input
                      id="edit-email"
                      type="email"
                      value={user.email}
                      disabled
                      className="mt-1 block w-full cursor-not-allowed rounded-lg border border-gray-300 bg-gray-100 py-3 px-4 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </div>
                </div>

                {/* Avatar Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 border-b border-gray-200 pb-2 dark:border-gray-700">
                    Avatar & Appearance
                  </h3>
                  <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-gray-700 dark:bg-gray-800/60">
                    <AvatarPicker
                      avatars={avatars}
                      loading={avatarsLoading}
                      selectedAvatarId={avatarAssetId}
                      selectedAvatarUrl={avatarPreview}
                      onSelectAvatar={handleSelectAvatar}
                      onRequestClear={handleClearAvatar}
                      onCustomAvatarCropped={handleCustomAvatarCropped}
                      uploading={avatarUploading}
                      previewClassName={previewFrameClass}
                    />
                    <div className="space-y-3">
                      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-300">Avatar Frame</p>
                      <div className="flex flex-wrap gap-3 justify-center">
                        {FRAME_OPTIONS.map((option) => {
                          const isActive = avatarFrame === option.id;
                          const frameClass = getFrameClassName(option.id, user.role);
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setAvatarFrame(option.id)}
                              className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-center transition-all min-w-[100px] ${
                                isActive
                                  ? 'border-indigo-500/80 bg-white shadow-lg shadow-indigo-500/30 dark:bg-slate-900'
                                  : 'border-gray-200 hover:border-indigo-400 hover:bg-white hover:shadow-md dark:border-gray-700 dark:hover:border-indigo-400 dark:hover:bg-slate-900'
                              }`}
                            >
                              <div className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm dark:bg-slate-900 ${frameClass}`}>
                                {avatarPreview ? (
                                  <img src={avatarPreview} alt="Avatar frame preview" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-[8px] uppercase tracking-[0.25em] text-gray-400 dark:text-gray-500">Frame</span>
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-100">{option.label}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Panel: Work Details */}
            <div className="flex-1 flex flex-col">
              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Work Details Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 border-b border-gray-200 pb-2 dark:border-gray-700">
                    Work Details
                  </h3>

                  {/* Employer ID */}
                  <div>
                    <label
                      htmlFor="edit-employerId"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-100"
                    >
                      Employer ID (Optional)
                    </label>
                    <input
                      id="edit-employerId"
                      type="text"
                      value={employerId}
                      onChange={(e) => setEmployerId(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-white py-3 px-4 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                  </div>

                  {/* Department */}
                  <div>
                    <label
                      htmlFor="edit-department"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-100"
                    >
                      Department
                    </label>
                    <select
                      id="edit-department"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="mt-1 block w-full rounded-lg border border-gray-300 bg-white py-3 px-4 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                      <option value="add_new">+ Add New Department</option>
                    </select>

                    {department === 'add_new' && (
                      <input
                        type="text"
                        placeholder="New department name"
                        value={newDepartmentName}
                        onChange={(e) => setNewDepartmentName(e.target.value)}
                        className="mt-3 block w-full rounded-lg border border-gray-300 bg-white py-3 px-4 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Error and Actions at bottom */}
          <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-700 flex-shrink-0">
            {/* Error */}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-4 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end sm:space-x-4">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-gray-300 bg-white px-6 py-3 text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow-md dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-3 text-white shadow-sm transition-all hover:from-blue-600 hover:to-blue-700 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </div>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserModal;




