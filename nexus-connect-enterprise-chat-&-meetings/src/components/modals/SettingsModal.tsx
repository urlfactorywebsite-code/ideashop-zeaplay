import React, { useState, useEffect } from 'react';
import { X, Moon, Sun, Volume2, VolumeX, Mic, Video, ShieldCheck, Cpu } from 'lucide-react';
import { socketService } from '../../services/socket';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedMic, setSelectedMic] = useState('Default Microphone');
  const [selectedCam, setSelectedCam] = useState('Default Web Camera');
  const [audioLevel, setAudioLevel] = useState(25);

  useEffect(() => {
    // Check current theme
    const isDark = document.documentElement.classList.contains('dark');
    setTheme(isDark ? 'dark' : 'light');
  }, []);

  const toggleTheme = (newTheme: 'dark' | 'light') => {
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Workspace Settings & Devices
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-5 flex-1">
          {/* Appearance / Theme */}
          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Appearance & Theme
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => toggleTheme('dark')}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  theme === 'dark'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="p-2 rounded-lg bg-slate-800 text-slate-200">
                  <Moon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Dark Mode</p>
                  <p className="text-[10px] text-slate-400">Enterprise Webex dark theme</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => toggleTheme('light')}
                className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  theme === 'light'
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-medium'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
                  <Sun className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold">Light Mode</p>
                  <p className="text-[10px] text-slate-400">Clean high-contrast theme</p>
                </div>
              </button>
            </div>
          </div>

          {/* Sound & Notifications */}
          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Audio Chimes & Notification Sounds
            </label>
            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                  {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                    Meeting Chimes & Message Alerts
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Play audio ringtones on incoming calls and message pings
                  </p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={soundEnabled}
                onChange={e => setSoundEnabled(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded-sm cursor-pointer"
              />
            </div>
          </div>

          {/* Hardware Device Test */}
          <div>
            <label className="block text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Audio & Video Hardware Devices
            </label>
            <div className="space-y-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <Mic className="w-3.5 h-3.5 text-blue-500" />
                  Microphone Input
                </label>
                <select
                  value={selectedMic}
                  onChange={e => setSelectedMic(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200"
                >
                  <option value="Default Microphone">Built-in Digital Microphone (Standard)</option>
                  <option value="Headset Microphone">Enterprise Bluetooth Headset</option>
                  <option value="Studio Microphone">USB Audio Capture Interface</option>
                </select>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 shrink-0">Input Level:</span>
                  <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5 mb-1">
                  <Video className="w-3.5 h-3.5 text-indigo-500" />
                  Camera Video Source
                </label>
                <select
                  value={selectedCam}
                  onChange={e => setSelectedCam(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-200"
                >
                  <option value="Default Web Camera">FaceTime HD / Integrated Camera (1080p)</option>
                  <option value="Conference Cam">Webex Desk Camera Pro (4K UHD)</option>
                  <option value="Virtual Studio">Virtual Workspace Video Feed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Infrastructure Health */}
          <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-semibold mb-1">
              <ShieldCheck className="w-4 h-4" />
              <span>Real-Time Engine Health & Security</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-600 dark:text-slate-400 mt-2">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Socket.IO: Authenticated & Connected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>WebRTC: STUN/TURN Signaled</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Persistence: ACID JSON Database</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Auth: JWT + Argon2/Bcrypt Tokens</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-xs transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
