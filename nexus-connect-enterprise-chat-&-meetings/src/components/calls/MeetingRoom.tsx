import React, { useState, useRef, useEffect } from 'react';
import { useCall } from '../../context/CallContext';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../common/Avatar';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  Users,
  MessageSquare,
  Copy,
  Check,
  Share2,
  Shield,
} from 'lucide-react';

export const MeetingRoom: React.FC = () => {
  const { user } = useAuth();
  const {
    activeMeetingId,
    activeMeetingTitle,
    meetingParticipants,
    localStream,
    isMuted,
    isVideoOff,
    isScreenSharing,
    toggleMute,
    toggleVideo,
    toggleScreenShare,
    leaveMeeting,
  } = useCall();

  const [copied, setCopied] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  if (!activeMeetingId) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between p-4 select-none animate-in fade-in duration-200">
      {/* Top Meeting Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/80 border border-slate-800 rounded-2xl backdrop-blur-md text-white">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-600/20 text-blue-400">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold">{activeMeetingTitle}</h2>
            <p className="text-[10px] text-slate-400 font-mono">
              Meeting ID: {activeMeetingId} • {meetingParticipants.length} connected
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Link Copied!' : 'Copy Invite Link'}</span>
          </button>
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 my-3 flex gap-3 overflow-hidden">
        {/* Video Tiles Grid */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-3 auto-rows-fr">
          {/* Local participant tile */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center shadow-lg group">
            {isVideoOff ? (
              <div className="text-center p-4">
                <Avatar name={user?.displayName || 'You'} avatarUrl={user?.avatarUrl} size="xl" showStatus={false} />
                <p className="text-xs font-semibold text-white mt-2">{user?.displayName} (You)</p>
                <p className="text-[10px] text-slate-400">Camera turned off</p>
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
            <div className="absolute bottom-3 left-3 px-2 py-1 rounded-lg bg-black/60 text-xs text-white backdrop-blur-xs flex items-center gap-1.5">
              <span>{user?.displayName} (You)</span>
              {isMuted && <MicOff className="w-3 h-3 text-rose-400" />}
            </div>
          </div>

          {/* Simulated remote enterprise meeting participants tiles */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center shadow-lg">
            <div className="text-center p-4">
              <Avatar
                name="Enterprise Room Node"
                avatarUrl="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
                size="xl"
                showStatus={false}
              />
              <p className="text-xs font-semibold text-white mt-2">Alex Rivera</p>
              <p className="text-[10px] text-slate-400">Active participant</p>
              <div className="flex items-center justify-center gap-1 mt-3">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-400 font-mono">Audio Synced</span>
              </div>
            </div>
            <div className="absolute bottom-3 left-3 px-2 py-1 rounded-lg bg-black/60 text-xs text-white backdrop-blur-xs">
              Alex Rivera
            </div>
          </div>
        </div>

        {/* Participant Roster Drawer */}
        {showRoster && (
          <div className="w-64 bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col animate-in slide-in-from-right-4">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Participants ({meetingParticipants.length + 1})
              </h3>
            </div>
            <div className="space-y-2 overflow-y-auto flex-1">
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-800/50">
                <div className="flex items-center gap-2">
                  <Avatar name={user?.displayName || 'You'} avatarUrl={user?.avatarUrl} size="sm" showStatus={false} />
                  <span className="text-xs text-white">{user?.displayName} (Host)</span>
                </div>
                {isMuted ? <MicOff className="w-3.5 h-3.5 text-rose-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
              </div>
              <div className="flex items-center justify-between p-2 rounded-xl bg-slate-800/30">
                <div className="flex items-center gap-2">
                  <Avatar name="Alex Rivera" avatarUrl="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80" size="sm" showStatus={false} />
                  <span className="text-xs text-slate-200">Alex Rivera</span>
                </div>
                <Mic className="w-3.5 h-3.5 text-emerald-400" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Meeting Controls */}
      <div className="flex items-center justify-center gap-3 p-2 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md shadow-2xl z-10 w-fit mx-auto">
        {/* Toggle Mic */}
        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition-all ${
            isMuted ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>

        {/* Toggle Video */}
        <button
          onClick={toggleVideo}
          className={`p-3 rounded-full transition-all ${
            isVideoOff ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isVideoOff ? 'Turn on Camera' : 'Turn off Camera'}
        >
          {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        </button>

        {/* Share Screen */}
        <button
          onClick={toggleScreenShare}
          className={`p-3 rounded-full transition-all ${
            isScreenSharing ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title={isScreenSharing ? 'Stop Screen Share' : 'Share Screen'}
        >
          <Monitor className="w-4 h-4" />
        </button>

        {/* Roster Toggle */}
        <button
          onClick={() => setShowRoster(!showRoster)}
          className={`p-3 rounded-full transition-all ${
            showRoster ? 'bg-blue-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
          }`}
          title="Participants Roster"
        >
          <Users className="w-4 h-4" />
        </button>

        {/* Leave Meeting */}
        <button
          onClick={leaveMeeting}
          className="p-3 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95 ml-2"
          title="Leave Meeting"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
