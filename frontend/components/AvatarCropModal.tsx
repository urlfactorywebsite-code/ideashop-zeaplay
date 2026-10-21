import React, { useCallback, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Cropper, { Area } from 'react-easy-crop';
import { AvatarCropMetadata } from '../types';
import { getCroppedImageDataUrl } from '../utils/image';

interface AvatarCropModalProps {
  isOpen: boolean;
  imageSrc: string | null;
  title?: string;
  onCancel: () => void;
  onComplete?: (dataUrl: string) => void;
  onCompleteWithMetadata?: (metadata: AvatarCropMetadata) => Promise<void> | void;
  aspect?: number;
}

const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  isOpen,
  imageSrc,
  title = 'Adjust avatar',
  onCancel,
  onComplete,
  onCompleteWithMetadata,
  aspect = 1,
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rotation = 0;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { setCrop({ x: 0, y: 0 }); setZoom(1); setError(null); }, [imageSrc]);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [isOpen]);

  const handleCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) {
      setError('Unable to crop image. Please try again.');
      return;
    }

    try {
      setIsSaving(true);
      if (onCompleteWithMetadata) {
        const metadata: AvatarCropMetadata = {
          x: croppedAreaPixels.x,
          y: croppedAreaPixels.y,
          width: croppedAreaPixels.width,
          height: croppedAreaPixels.height,
          scale: zoom,
          rotate: rotation,
        };
        await onCompleteWithMetadata(metadata);
      }
      if (onComplete) {
        const cropped = await getCroppedImageDataUrl(imageSrc, croppedAreaPixels);
        await onComplete(cropped);
      }
    } catch (cropError) {
      setError(cropError instanceof Error ? cropError.message : 'Failed to crop image');
    } finally {
      setIsSaving(false);
    }
  }, [croppedAreaPixels, imageSrc, onComplete, onCompleteWithMetadata, rotation, zoom]);

  if (!isOpen || !imageSrc) {
    return null;
  }

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={event => {
      if (event.key === 'Escape' && !isSaving) onCancel();
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }} className="fixed inset-0 z-[10000] p-3 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label="Close cropper"
          >
            ✕
          </button>
        </div>

        <div className="relative h-[min(360px,50vh)] w-full bg-slate-900/80 dark:bg-slate-800">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
            cropShape="round"
            showGrid={false}
            restrictPosition
          />
        </div>

        <div className="flex flex-wrap gap-4 items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              Zoom
            </label>
            <input
              aria-label="Zoom avatar"
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-44 accent-indigo-500 dark:accent-indigo-400"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
            disabled={isSaving}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleConfirm}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : 'Save avatar'}
            </button>
          </div>
        </div>

        {error && (
          <div className="border-t border-rose-200 bg-rose-50 px-6 py-3 text-sm font-medium text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>
    </div>, document.body
  );
};

export default AvatarCropModal;
