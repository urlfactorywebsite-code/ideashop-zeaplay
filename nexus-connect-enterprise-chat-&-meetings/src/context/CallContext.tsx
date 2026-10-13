import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { ActiveCall, CallType, User } from '../types';
import { socketService } from '../services/socket';
import { useAuth } from './AuthContext';

interface CallContextType {
  activeCall: ActiveCall | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  callDuration: number;
  // Meeting state
  activeMeetingId: string | null;
  activeMeetingTitle: string | null;
  meetingParticipants: {
    socketId: string;
    userId: string;
    displayName: string;
    avatarUrl?: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
  }[];

  // Actions
  initiateCall: (recipient: { id: string; displayName: string; avatarUrl?: string; title?: string }, type: CallType, conversationId?: string) => Promise<void>;
  acceptCall: (type?: CallType) => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  startMeeting: (title?: string, conversationId?: string) => Promise<void>;
  joinMeeting: (meetingId: string, title?: string) => Promise<void>;
  leaveMeeting: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

// Web Audio sound generator for rings and alerts
class SoundEffects {
  private ctx: AudioContext | null = null;
  private ringOscillator: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private ringInterval: any = null;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playRing() {
    try {
      this.initCtx();
      if (!this.ctx) return;
      this.stopRing();

      const playTone = () => {
        if (!this.ctx) return;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(440, this.ctx.currentTime); // A4
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(480, this.ctx.currentTime);

        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(this.ctx.currentTime + 1.2);
        osc2.stop(this.ctx.currentTime + 1.2);
      };

      playTone();
      this.ringInterval = setInterval(playTone, 2500);
    } catch (e) {
      // Audio might be blocked until gesture
    }
  }

  stopRing() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  playBeep(isPositive = true) {
    try {
      this.initCtx();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isPositive ? 600 : 350, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.06, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch (e) {}
  }
}

const sounds = new SoundEffects();

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export const CallProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [callDuration, setCallDuration] = useState<number>(0);

  // Group Meeting state
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [activeMeetingTitle, setActiveMeetingTitle] = useState<string | null>(null);
  const [meetingParticipants, setMeetingParticipants] = useState<{
    socketId: string;
    userId: string;
    displayName: string;
    avatarUrl?: string;
    audioEnabled: boolean;
    videoEnabled: boolean;
  }[]>([]);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const callDurationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const incomingOfferSignalRef = useRef<any>(null);

  // Timer for connected call
  useEffect(() => {
    if (activeCall?.state === 'connected') {
      sounds.stopRing();
      setCallDuration(0);
      callDurationTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (callDurationTimerRef.current) {
        clearInterval(callDurationTimerRef.current);
        callDurationTimerRef.current = null;
      }
    }
    return () => {
      if (callDurationTimerRef.current) {
        clearInterval(callDurationTimerRef.current);
      }
    };
  }, [activeCall?.state]);

  // Create virtual media stream if hardware devices fail (e.g. headless/restricted browser)
  const getMediaStream = async (type: CallType): Promise<MediaStream> => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: type === 'video',
        });
        return stream;
      }
    } catch (err) {
      console.warn('Real user media devices not available, generating virtual audio/video track:', err);
    }

    // Fallback virtual track
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '24px sans-serif';
      ctx.fillText(user?.displayName || 'Nexus User', 50, 240);
    }
    const canvasStream = canvas.captureStream(15);
    
    // Add silent audio track via AudioContext
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const actx = new AudioCtx();
        const osc = actx.createOscillator();
        const dst = actx.createMediaStreamDestination();
        const gain = actx.createGain();
        gain.gain.value = 0.0001; // virtually silent
        osc.connect(gain);
        gain.connect(dst);
        osc.start();
        dst.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
      }
    } catch (e) {}

    return canvasStream;
  };

  // Setup PeerConnection
  const createPeerConnection = (targetUserId: string): RTCPeerConnection => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketService.sendCandidate(targetUserId, event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      } else {
        const newStream = new MediaStream([event.track]);
        setRemoteStream(newStream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setActiveCall(prev => (prev ? { ...prev, state: 'connected' } : null));
        sounds.playBeep(true);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        // Disconnected
      }
    };

    return pc;
  };

  // Socket event listeners for calling
  useEffect(() => {
    const socket = socketService.getSocket();
    if (!socket) return;

    const handleIncomingCall = (data: {
      callerId: string;
      callerName: string;
      callerAvatar?: string;
      callerTitle?: string;
      callType: CallType;
      conversationId?: string;
      signalData: any;
    }) => {
      sounds.playRing();
      incomingOfferSignalRef.current = data.signalData;
      setActiveCall({
        state: 'incoming',
        callType: data.callType,
        remoteUserId: data.callerId,
        remoteUserName: data.callerName,
        remoteUserAvatar: data.callerAvatar,
        remoteUserTitle: data.callerTitle,
        conversationId: data.conversationId,
        isInitiator: false,
      });
    };

    const handleCallAnswered = async (data: { responderId: string; signalData: any }) => {
      sounds.stopRing();
      const pc = peerConnectionRef.current;
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signalData));
          setActiveCall(prev => (prev ? { ...prev, state: 'connected' } : null));

          // Process queued ICE candidates
          while (pendingCandidatesRef.current.length > 0) {
            const candidate = pendingCandidatesRef.current.shift();
            if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
        } catch (err) {
          console.error('Error setting remote description on call answered:', err);
        }
      }
    };

    const handleCallCandidate = async (data: { candidate: any; fromUserId: string }) => {
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      } else {
        pendingCandidatesRef.current.push(data.candidate);
      }
    };

    const handleCallRejected = () => {
      sounds.stopRing();
      sounds.playBeep(false);
      endCall();
    };

    const handleCallEnded = () => {
      sounds.stopRing();
      sounds.playBeep(false);
      endCall();
    };

    socket.on('call:incoming', handleIncomingCall);
    socket.on('call:answered', handleCallAnswered);
    socket.on('call:candidate', handleCallCandidate);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);

    return () => {
      socket.off('call:incoming', handleIncomingCall);
      socket.off('call:answered', handleCallAnswered);
      socket.off('call:candidate', handleCallCandidate);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
    };
  }, []);

  const initiateCall = async (
    recipient: { id: string; displayName: string; avatarUrl?: string; title?: string },
    type: CallType,
    conversationId?: string
  ) => {
    try {
      sounds.playRing();
      const stream = await getMediaStream(type);
      setLocalStream(stream);

      const pc = createPeerConnection(recipient.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socketService.initiateCall({
        recipientId: recipient.id,
        callType: type,
        conversationId: conversationId || '',
        signalData: offer,
      });

      setActiveCall({
        state: 'outgoing',
        callType: type,
        remoteUserId: recipient.id,
        remoteUserName: recipient.displayName,
        remoteUserAvatar: recipient.avatarUrl,
        remoteUserTitle: recipient.title,
        conversationId,
        isInitiator: true,
      });
    } catch (err) {
      console.error('Failed to initiate call:', err);
      sounds.stopRing();
    }
  };

  const acceptCall = async (overrideType?: CallType) => {
    sounds.stopRing();
    if (!activeCall) return;

    try {
      const type = overrideType || activeCall.callType;
      const stream = await getMediaStream(type);
      setLocalStream(stream);

      const pc = createPeerConnection(activeCall.remoteUserId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      if (incomingOfferSignalRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferSignalRef.current));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketService.answerCall({
        callerId: activeCall.remoteUserId,
        signalData: answer,
      });

      // Process buffered candidates
      while (pendingCandidatesRef.current.length > 0) {
        const candidate = pendingCandidatesRef.current.shift();
        if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      setActiveCall(prev => (prev ? { ...prev, state: 'connected', callType: type } : null));
    } catch (err) {
      console.error('Failed to accept call:', err);
      endCall();
    }
  };

  const declineCall = () => {
    sounds.stopRing();
    if (activeCall) {
      socketService.rejectCall(activeCall.remoteUserId);
    }
    endCall();
  };

  const endCall = () => {
    sounds.stopRing();
    if (activeCall) {
      socketService.endCall(activeCall.remoteUserId);
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(t => t.stop());
      setRemoteStream(null);
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];
    incomingOfferSignalRef.current = null;
    setActiveCall(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setCallDuration(0);
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Revert to camera
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      const camStream = await getMediaStream(activeCall?.callType || 'video');
      setLocalStream(camStream);
      if (peerConnectionRef.current) {
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find(s => s.track?.kind === 'video');
        if (videoSender && camStream.getVideoTracks()[0]) {
          videoSender.replaceTrack(camStream.getVideoTracks()[0]);
        }
      }
      setIsScreenSharing(false);
    } else {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
          const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
          const screenTrack = screenStream.getVideoTracks()[0];

          if (peerConnectionRef.current) {
            const senders = peerConnectionRef.current.getSenders();
            const videoSender = senders.find(s => s.track?.kind === 'video');
            if (videoSender) {
              videoSender.replaceTrack(screenTrack);
            }
          }

          screenTrack.onended = () => {
            toggleScreenShare();
          };

          setIsScreenSharing(true);
        }
      } catch (err) {
        console.warn('Screen sharing cancelled or unsupported', err);
      }
    }
  };

  // Group Meeting controls
  const startMeeting = async (title?: string, conversationId?: string) => {
    const meetingTitle = title || `${user?.displayName || 'Enterprise'}'s Personal Room`;
    const meetingId = `meet_${Date.now().toString(36)}`;
    await joinMeeting(meetingId, meetingTitle);
  };

  const joinMeeting = async (meetingId: string, title?: string) => {
    setActiveMeetingId(meetingId);
    setActiveMeetingTitle(title || `Meeting ${meetingId}`);

    const stream = await getMediaStream('video');
    setLocalStream(stream);

    socketService.joinMeeting({
      meetingId,
      userInfo: {
        userId: user?.id || 'usr_guest',
        displayName: user?.displayName || 'Colleague',
        avatarUrl: user?.avatarUrl,
        audioEnabled: true,
        videoEnabled: true,
      },
    });

    // Populate self as first participant
    setMeetingParticipants([
      {
        socketId: 'self',
        userId: user?.id || 'usr_guest',
        displayName: user?.displayName || 'You (Host)',
        avatarUrl: user?.avatarUrl,
        audioEnabled: true,
        videoEnabled: true,
      },
    ]);
  };

  const leaveMeeting = () => {
    if (activeMeetingId) {
      socketService.leaveMeeting(activeMeetingId);
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      setLocalStream(null);
    }
    setActiveMeetingId(null);
    setActiveMeetingTitle(null);
    setMeetingParticipants([]);
    setIsScreenSharing(false);
  };

  return (
    <CallContext.Provider
      value={{
        activeCall,
        localStream,
        remoteStream,
        isMuted,
        isVideoOff,
        isScreenSharing,
        callDuration,
        activeMeetingId,
        activeMeetingTitle,
        meetingParticipants,
        initiateCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleVideo,
        toggleScreenShare,
        startMeeting,
        joinMeeting,
        leaveMeeting,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
