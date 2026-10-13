import React from 'react';
import { useGlobalLoading } from '../../hooks/useGlobalLoading';

const GlobalProgressBar: React.FC = () => {
  const {
    state: { isVisible, progress, isDeterminate },
  } = useGlobalLoading();

  return (
    <div
      className={`global-progress ${isVisible ? 'global-progress-visible' : ''} ${
        isDeterminate ? 'global-progress-determinate' : 'global-progress-indeterminate'
      }`}
      role="progressbar"
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
      aria-valuenow={isDeterminate ? Math.round(progress) : undefined}
      aria-hidden={!isVisible}
    >
      <div className="global-progress-track">
        <div className="global-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
    </div>
  );
};

export default GlobalProgressBar;
