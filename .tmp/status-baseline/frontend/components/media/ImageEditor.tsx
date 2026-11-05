import React, { useCallback, useState } from 'react';
import Cropper, { Area } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';

type ImageEditorProps = {
  imageUrl: string;
  mimeType: string;
  onCancel: () => void;
  onExport: (blob: Blob) => Promise<void> | void;
};

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

const getEditedBlob = async (
  imageSrc: string,
  crop: Area,
  rotation: number,
  flip: { horizontal: boolean; vertical: boolean },
  mimeType: string
): Promise<Blob> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas not supported');
  }

  const radians = (rotation * Math.PI) / 180;
  const safeArea = Math.max(image.width, image.height) * 2;

  canvas.width = safeArea;
  canvas.height = safeArea;

  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate(radians);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(crop.x, crop.y, crop.width, crop.height);
  canvas.width = crop.width;
  canvas.height = crop.height;
  ctx.putImageData(data, 0, 0);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Unable to export image'));
      }
    }, mimeType || 'image/png');
  });
};

const ImageEditor: React.FC<ImageEditorProps> = ({ imageUrl, mimeType, onCancel, onExport }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCropPixels(pixels);
  }, []);

  const handleExport = useCallback(async () => {
    if (!cropPixels) return;
    setIsSaving(true);
    try {
      const blob = await getEditedBlob(imageUrl, cropPixels, rotation, flip, mimeType);
      await onExport(blob);
    } finally {
      setIsSaving(false);
    }
  }, [cropPixels, imageUrl, rotation, flip, mimeType, onExport]);

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-4 shadow-lg shadow-black/30">
      <div className="relative h-72 w-full overflow-hidden rounded-2xl bg-black">
        <Cropper
          image={imageUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={16 / 9}
          showGrid={false}
          onCropChange={setCrop}
          onRotationChange={setRotation}
          onCropComplete={onCropComplete}
          onZoomChange={setZoom}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-white">
        <label className="flex items-center gap-2">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <label className="flex items-center gap-2">
          Rotate
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value))}
          />
        </label>
        <button
          type="button"
          className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide text-slate-200 hover:border-indigo-400 hover:text-indigo-200"
          onClick={() => setFlip((current) => ({ ...current, horizontal: !current.horizontal }))}
        >
          Flip X
        </button>
        <button
          type="button"
          className="rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide text-slate-200 hover:border-indigo-400 hover:text-indigo-200"
          onClick={() => setFlip((current) => ({ ...current, vertical: !current.vertical }))}
        >
          Flip Y
        </button>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!cropPixels || isSaving}
          onClick={handleExport}
          className="rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow shadow-indigo-900/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Apply edits'}
        </button>
      </div>
    </div>
  );
};

export default ImageEditor;
