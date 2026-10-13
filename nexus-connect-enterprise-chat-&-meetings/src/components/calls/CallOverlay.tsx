import React, { useRef, useEffect } from 'react';
import { useCall } from '../../context/CallContext';
import { Avatar } from '../common/Avatar';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  Maximize2,
  Minimize2,
  Radio,
} from 'lucide-react';

export const CallOverlay: React.FC = () => {
  const {
    activeCall,
    localStream,
    remoteStream,
    isMuted,
    isVideoOff,
    isScreenSharing,
    callDuration,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    endCall,
  } = useCall();

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Bind local stream
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Bind remote stream
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (!activeCall || activeCall.state === 'incoming') return null;

  const isConnected = activeCall.state === 'connected';
  const isVideo = activeCall.callType === 'video';

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-between p-6 select-none animate-in fade-in duration-200">
      {/* Top Header Bar */}
      <div className="w-full max-w-5xl flex items-center justify-between text-white z-10">
        <div className="flex items-center gap-3">
          <Avatar
            name={activeCall.remoteUserName}
            avatarUrl={activeCall.remoteUserAvatar}
            size="md"
            showStatus={false}
          />
          <div>
            <h2 className="text-sm font-bold">{activeCall.remoteUserName}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {isConnected ? 'Connected' : 'Calling...'}
              </span>
              {isConnected && <span>• {formatDuration(callDuration)}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-mono text-emerald-400 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            <span>WebRTC Direct P2P</span>
          </div>
        </div>
      </div>

      {/* Main View Area */}
      <div className="relative w-full max-w-5xl flex-1 my-4 rounded-3xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center shadow-2xl">
        {/* Remote Video / Audio visualizer */}
        {remoteStream && isVideo ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center p-8">
            <div className="relative inline-block mb-4">
              {isConnected && (
                <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping duration-1000" />
              )}
              <Avatar
                name={activeCall.remoteUserName}
                avatarUrl={activeCall.remoteUserAvatar}
                size="xl"
                showStatus={false}
              />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              {activeCall.remoteUserName}
            </h3>
            <p className="text-xs text-slate-400">
              {isConnected ? 'Audio connected' : 'Connecting peer-to-peer stream...'}
            </p>

            {/* Audio Waveform visualization */}
            {isConnected && (
              <div className="flex items-center justify-center gap-1 mt-6 h-8">
                {[40, 75, 55, 90, 60, 85, 45, 95, 70, 50].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-blue-500 rounded-full animate-pulse"
                    style={{
                      height: `${h}%`,
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Local Video Picture-in-Picture Thumbnail */}
        {localStream && (
          <div className="absolute bottom-4 right-4 w-48 h-36 rounded-2xl overflow-hidden border-2 border-slate-700/80 bg-slate-800 shadow-xl z-20">
            {isVideoOff ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-400 text-xs">
                <VideoOff className="w-5 h-5 mb-1" />
                <span>Camera off</span>
              </div>
            ) : (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            )}
            <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white">
              You {isMuted && '• Muted'}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="flex items-center justify-center gap-3 p-2 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md shadow-2xl z-10">
        {/* Toggle Mic */}
        <button
          onClick={toggleMute}
          className={`p-3.5 rounded-full transition-all ${
            isMuted
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Toggle Video */}
        <button
          onClick={toggleVideo}
          className={`p-3.5 rounded-full transition-all ${
            isVideoOff
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isVideoOff ? 'Turn on Camera' : 'Turn off Camera'}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </button>

        {/* Share Screen */}
        <button
          onClick={toggleScreenShare}
          className={`p-3.5 rounded-full transition-all ${
            isScreenSharing
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
        >
          <Monitor className="w-5 h-5" />
        </button>

        {/* End Call */}
        <button
          onClick={endCall}
          className="p-3.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95 ml-2"
          title="End Call"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
