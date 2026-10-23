import React, { useEffect, useState } from 'react';

export default function HeaderBackground() {
  const [loadVideo, setLoadVideo] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    let firstFrame = 0, secondFrame = 0, idle = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      if (idle) window.cancelIdleCallback(idle);
      clearTimeout(timer);
    };
    const update = () => {
      cancel();
      setLoadVideo(false);
      if (motion.matches || connection?.saveData) return;
      // Give the poster a paint opportunity before discovering decorative media.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if ('requestIdleCallback' in window) {
            idle = window.requestIdleCallback(() => setLoadVideo(true), { timeout: 1000 });
          } else {
            timer = globalThis.setTimeout(() => setLoadVideo(true), 150);
          }
        });
      });
    };
    update();
    motion.addEventListener('change', update);
    return () => { cancel(); motion.removeEventListener('change', update); };
  }, []);

  return <div className="zea-header-media pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
    <img src="/header-poster.webp" alt="" fetchPriority="high" loading="eager" decoding="async"
      className="zea-header-poster absolute inset-0 h-full w-full object-cover" />
    {loadVideo && <video className="zea-header-video absolute inset-0 h-full w-full object-cover"
      autoPlay muted loop playsInline preload="none" poster="/header-poster.webp">
      <source src="https://res.cloudinary.com/dqhcbck76/video/upload/v1770339698/Untitled_design_2_opyhae.mp4" type="video/mp4" />
    </video>}
  </div>;
}
