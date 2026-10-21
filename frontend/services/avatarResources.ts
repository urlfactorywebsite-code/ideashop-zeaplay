// Session-local decoded images: deduplicate requests without putting private photos
// in persistent browser storage. Versioned URLs are distinct cache entries.
type Entry = { promise: Promise<string>; url?: string; references: number; touched: number };
export function createAvatarImageCache(load: (source: string, size: number) => Promise<Blob>, maxIdle = 48) {
  const entries = new Map<string, Entry>();
  const discard = (key: string, entry: Entry) => {
    if (entry.url) URL.revokeObjectURL(entry.url);
    entries.delete(key);
  };
  const prune = () => {
    const idle = [...entries].filter(([, entry]) => !entry.references).sort((a, b) => a[1].touched - b[1].touched);
    while (idle.length && (idle.length > maxIdle || Date.now() - idle[0][1].touched >= 60_000)) {
      const [key, entry] = idle.shift()!;
      discard(key, entry);
    }
  };
  return {
    acquire(source: string, size: number) {
      prune();
      const key = `${size}:${source}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = { references: 0, touched: Date.now(), promise: Promise.resolve('') };
        const created = entry;
        entries.set(key, entry);
        entry.promise = load(source, size).then(blob => {
          if (entries.get(key) !== created) throw new Error('Avatar session ended');
          created.url = URL.createObjectURL(blob);
          return created.url;
        }).catch(error => { if (entries.get(key) === created) discard(key, created); throw error; });
      }
      entry.references++;
      entry.touched = Date.now();
      let released = false;
      return { promise: entry.promise, release: () => {
        if (released) return;
        released = true;
        entry.references--;
        entry.touched = Date.now();
        prune();
      } };
    },
    clear() { for (const [key, entry] of entries) discard(key, entry); },
  };
}

export const avatarImages = createAvatarImageCache(async (source, size) => {
  const { http } = await import('./mockApi');
  const response = await http.get(source.replace(/^\/api/, ''), { params: { size }, responseType: 'blob', showGlobalProgress: false });
  return response.data;
});

const pendingProfiles = new Map<string, Promise<unknown>>();
export function ensureAvatarProfile(id: string) {
  if (!pendingProfiles.has(id)) {
    const pending = import('./mockApi').then(({ default: api }) => api.getUserProfile(id)).finally(() => {
      if (pendingProfiles.get(id) === pending) pendingProfiles.delete(id);
    });
    pendingProfiles.set(id, pending);
  }
  return pendingProfiles.get(id)!;
}
export function clearAvatarResources() { avatarImages.clear(); pendingProfiles.clear(); }
