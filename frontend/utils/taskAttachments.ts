export type AttachmentKind = 'image' | 'pdf' | 'text' | 'file' | 'link';

export function safeAttachmentUrl(value: string, base = typeof window === 'undefined' ? 'http://localhost/' : window.location.href) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function attachmentInfo(url: string, file?: Pick<File, 'name' | 'type' | 'size'>) {
  let name = file?.name || '';
  if (!name) {
    try {
      const parsed = new URL(url, 'http://localhost/');
      name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || parsed.hostname);
    } catch { name = 'Attachment'; }
  }
  const extension = name.match(/\.([a-z0-9]{1,10})$/i)?.[1].toLowerCase() || '';
  const mime = file?.type.toLowerCase() || '';
  const kind: AttachmentKind = mime === 'application/pdf' || extension === 'pdf' ? 'pdf'
    : /^(png|jpe?g|gif|webp|avif|bmp|ico)$/.test(extension) || /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/.test(mime) ? 'image'
    : /^(txt|csv|md|json|log|eml)$/.test(extension) || /^(text\/plain|text\/csv|application\/json|message\/rfc822)$/.test(mime) ? 'text'
    : extension || file ? 'file' : 'link';
  const label = kind === 'pdf' ? 'PDF' : extension ? extension.toUpperCase() : kind === 'image' ? 'IMAGE' : kind === 'text' ? 'TEXT' : kind === 'link' ? 'LINK' : 'FILE';
  const description = kind === 'pdf' ? 'PDF document' : kind === 'image' ? 'Image' : extension === 'eml' ? 'Email' : kind === 'text' ? 'Text document' : kind === 'link' ? 'Link' : 'File';
  return { name, extension, kind, label, description, size: file?.size };
}

export function attachmentBytes(size?: number) {
  if (size === undefined) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Never load a user-provided HTML/SVG URL into an iframe. Only verified PDF
// bytes reach the native PDF viewer; raster images use an inert image element.
export async function attachmentPreviewMime(blob: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte);
  const text = new TextDecoder('ascii').decode(bytes);
  if (text.startsWith('%PDF-')) return 'application/pdf';
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  if (text.startsWith('BM')) return 'image/bmp';
  if (starts(0, 0, 1, 0)) return 'image/x-icon';
  if (text.slice(4, 8) === 'ftyp' && /avif|avis/.test(text.slice(8, 32))) return 'image/avif';
  return null;
}
