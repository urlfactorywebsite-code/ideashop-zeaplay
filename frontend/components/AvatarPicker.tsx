import React, { useMemo, useRef, useState } from 'react';
import { AvatarAsset } from '../types';
import AvatarCropModal from './AvatarCropModal';

interface AvatarPickerProps {
  avatars: AvatarAsset[];
  loading?: boolean;
  selectedAvatarId: string | null;
  selectedAvatarUrl: string | null;
  customPreviewUrl?: string | null;
  onSelectAvatar: (asset: AvatarAsset) => void;
  onRequestClear?: () => void;
  onCustomAvatarCropped: (dataUrl: string) => Promise<void> | void;
  uploading?: boolean;
  disabled?: boolean;
  previewClassName?: string;
}

const AvatarPicker: React.FC<AvatarPickerProps> = ({
  avatars,
  loading = false,
  selectedAvatarId,
  selectedAvatarUrl,
  customPreviewUrl,
  onSelectAvatar,
  onRequestClear,
  onCustomAvatarCropped,
  uploading = false,
  disabled = false,
  previewClassName = 'border-2 border-indigo-500/60',
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const previewUrl = useMemo(() => {
    if (customPreviewUrl) {
      return customPreviewUrl;
    }
    return selectedAvatarUrl;
  }, [customPreviewUrl, selectedAvatarUrl]);

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setLocalError('Please choose an image file (png, jpg, gif, svg).');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setPendingImage(result);
        setIsCropOpen(true);
      }
    };
    reader.onerror = () => {
      setLocalError('We could not read that file. Please try another image.');
    };
    reader.readAsDataURL(file);
  };

  const handleTriggerUpload = () => {
    if (disabled || uploading) return;
    setLocalError(null);
    fileInputRef.current?.click();
  };

  const handleCropComplete = async (dataUrl: string) => {
    try {
      setIsCropOpen(false);
      setPendingImage(null);
      await onCustomAvatarCropped(dataUrl);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to save avatar');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Avatar</span>
          {previewUrl && onRequestClear && (
            <button
              type="button"
              className="text-xs font-semibold text-rose-500 transition hover:text-rose-400"
              onClick={onRequestClear}
            >
              Clear custom
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Choose from the workspace library or upload a custom profile picture.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className={`h-16 w-16 overflow-hidden rounded-full shadow-inner ${previewClassName}`}>
          {previewUrl ? (
            <img src={previewUrl} alt="Avatar preview" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm font-medium text-slate-400 dark:bg-slate-800 dark:text-slate-500">
              None
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-indigo-500 px-3 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
            onClick={handleTriggerUpload}
            disabled={disabled || uploading}
          >
            {uploading ? 'Uploading…' : 'Upload custom'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileSelection}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Library
        </p>
        {loading ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            Loading avatars…
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-3">
            {avatars.map((asset) => {
              const isActive = asset.id === selectedAvatarId;
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={`group relative h-16 w-16 overflow-hidden rounded-full border-2 transition focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    isActive ? 'border-indigo-500 shadow-lg shadow-indigo-500/30' : 'border-transparent hover:border-slate-300'
                  }`}
                  onClick={() => {
                    setLocalError(null);
                    onSelectAvatar(asset);
                  }}
                >
                  <img
                    src={asset.url ?? asset.externalUrl ?? ''}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-1 left-1 right-1 rounded-full bg-black/50 px-1 text-center text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100">
                    {asset.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {localError && (
        <p className="text-sm font-medium text-rose-500 dark:text-rose-400">{localError}</p>
      )}

      {isCropOpen && pendingImage && (
        <AvatarCropModal
          isOpen={isCropOpen}
          imageSrc={pendingImage}
          onCancel={() => {
            setIsCropOpen(false);
            setPendingImage(null);
          }}
          onComplete={handleCropComplete}
        />
      )}
    </div>
  );
};

export default AvatarPicker;
