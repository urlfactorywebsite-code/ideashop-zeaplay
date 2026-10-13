import React from 'react';
import { useCall } from '../../context/CallContext';
import { Avatar } from '../common/Avatar';
import { Phone, Video, PhoneOff } from 'lucide-react';

export const IncomingCallModal: React.FC = () => {
  const { activeCall, acceptCall, declineCall } = useCall();

  if (!activeCall || activeCall.state !== 'incoming') return null;

  const isVideo = activeCall.callType === 'video';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl relative overflow-hidden">
        {/* Pulsating background ring */}
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/20 rounded-full blur-2xl animate-pulse" />
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-500/20 rounded-full blur-2xl animate-pulse" />

        <div className="relative z-10">
          {/* Avatar with pulsing waves */}
          <div className="relative inline-block mb-4">
            <span className="absolute inset-0 rounded-full bg-blue-500/30 animate-ping duration-1000" />
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
          <p className="text-xs text-slate-400 mb-6">
            Incoming {isVideo ? 'Video' : 'Audio'} Call...
          </p>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-4">
            {/* Decline */}
            <button
              onClick={declineCall}
              className="p-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95"
              title="Decline"
            >
              <PhoneOff className="w-5 h-5" />
            </button>

            {/* Accept with Audio */}
            <button
              onClick={() => acceptCall('audio')}
              className="p-4 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95"
              title="Accept Audio"
            >
              <Phone className="w-5 h-5" />
            </button>

            {/* Accept with Video */}
            {isVideo && (
              <button
                onClick={() => acceptCall('video')}
                className="p-4 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-transform active:scale-95"
                title="Accept Video"
              >
                <Video className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
