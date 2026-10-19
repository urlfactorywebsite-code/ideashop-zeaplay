import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from '../../../types';
import { getAccessToken } from '../../../services/tokenStorage';
import { acquireSharedPresenceSocket, SharedSocketIoLease } from '../../../services/sharedSocketIo';

export type NexusCallType = 'audio' | 'video';
export type NexusCallState = 'outgoing' | 'incoming' | 'connected';

export type NexusCallPeer = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  title?: string | null;
};

export type NexusActiveCall = {
  state: NexusCallState;
  callType: NexusCallType;
  remoteUserId: string;
  remoteUserName: string;
  remoteUserAvatar?: string | null;
  remoteUserTitle?: string | null;
  conversationId?: string | null;
  isInitiator: boolean;
  startedAt?: number;
};

export type NexusMeetingParticipant = {
  socketId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing?: boolean;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const useNexusCalls = (currentUser?: User | null) => {
  const [connected, setConnected] = useState(false);
  const [activeCall, setActiveCall] = useState<NexusActiveCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setMuted] = useState(false);
  const [isVideoOff, setVideoOff] = useState(false);
  const [isScreenSharing, setScreenSharing] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null);
  const [activeMeetingTitle, setActiveMeetingTitle] = useState<string | null>(null);
  const [meetingParticipants, setMeetingParticipants] = useState<NexusMeetingParticipant[]>([]);

  const socketRef = useRef<SharedSocketIoLease | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const callTimerRef = useRef<number | null>(null);
  const activeCallRef = useRef<NexusActiveCall | null>(null);
  const activeMeetingIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    activeMeetingIdRef.current = activeMeetingId;
  }, [activeMeetingId]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    remoteStreamRef.current = remoteStream;
  }, [remoteStream]);

  const stopMediaTracks = useCallback(() => {
    const streams = [localStreamRef.current, remoteStreamRef.current];
    streams.forEach((stream) => {
      stream?.getTracks().forEach((track) => track.stop());
    });
    localStreamRef.current = null;
    remoteStreamRef.current = null;
  }, []);

  const stopStreams = useCallback(() => {
    stopMediaTracks();
    setLocalStream(null);
    setRemoteStream(null);
  }, [stopMediaTracks]);

  const setLocalMediaStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    setLocalStream(stream);
  }, []);

  const setRemoteMediaStream = useCallback((stream: MediaStream | null) => {
    remoteStreamRef.current = stream;
    setRemoteStream(stream);
  }, []);

  const getMediaStream = useCallback(async (type: NexusCallType): Promise<MediaStream> => {
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      }
    } catch (error) {
      console.warn('nexus.call.media_unavailable', error);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#38bdf8';
      context.font = '24px sans-serif';
      context.fillText(currentUser?.name || 'Zeaplay user', 48, 180);
    }
    const stream = canvas.captureStream(15);
    try {
      const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      }
    } catch {
      // Browser audio fallback is optional.
    }
    return stream;
  }, [currentUser?.name]);

  const createPeerConnection = useCallback((targetUserId: string) => {
    peerConnectionRef.current?.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('call:candidate', { targetUserId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      setRemoteMediaStream(event.streams?.[0] ?? new MediaStream([event.track]));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setActiveCall((call) => {
          const next = call ? { ...call, state: 'connected' as const, startedAt: call.startedAt ?? Date.now() } : null;
          activeCallRef.current = next;
          return next;
        });
      }
      if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
        setActiveCall((call) => {
          const next = call?.state === 'connected' ? call : null;
          activeCallRef.current = next;
          return next;
        });
      }
    };
    return pc;
  }, [setRemoteMediaStream]);

  const endCall = useCallback((notify = true) => {
    const targetUserId = activeCallRef.current?.remoteUserId;
    if (notify && targetUserId) {
      socketRef.current?.emit('call:end', { targetUserId });
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    incomingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    stopStreams();
    activeCallRef.current = null;
    setActiveCall(null);
    setMuted(false);
    setVideoOff(false);
    setScreenSharing(false);
    setCallDuration(0);
  }, [stopStreams]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (!currentUser?.id || !accessToken) {
      setConnected(false);
      activeCallRef.current = null;
      activeMeetingIdRef.current = null;
      stopStreams();
      setActiveCall(null);
      setActiveMeetingId(null);
      setMeetingParticipants([]);
      return undefined;
    }

    const lease = acquireSharedPresenceSocket(currentUser.id, currentUser.tenantId);
    if (!lease) {
      setConnected(false);
      return undefined;
    }
    socketRef.current = lease;

    const unsubscribers = [
      lease.subscribeStatus((status) => setConnected(status === 'connected')),
      lease.on('call:incoming', (payload: {
        callerId: string;
        callerName?: string;
        callerAvatar?: string;
        callerTitle?: string;
        callType?: NexusCallType;
        conversationId?: string;
        signalData?: RTCSessionDescriptionInit;
      }) => {
        incomingOfferRef.current = payload.signalData ?? null;
        const nextCall: NexusActiveCall = {
          state: 'incoming',
          callType: payload.callType === 'video' ? 'video' : 'audio',
          remoteUserId: payload.callerId,
          remoteUserName: payload.callerName || 'Colleague',
          remoteUserAvatar: payload.callerAvatar,
          remoteUserTitle: payload.callerTitle,
          conversationId: payload.conversationId,
          isInitiator: false,
        };
        activeCallRef.current = nextCall;
        setActiveCall(nextCall);
      }),
      lease.on('call:answered', async (payload: { responderId: string; signalData?: RTCSessionDescriptionInit }) => {
        if (!peerConnectionRef.current || !payload.signalData) return;
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(payload.signalData));
        while (pendingCandidatesRef.current.length > 0) {
          const candidate = pendingCandidatesRef.current.shift();
          if (candidate) await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
        setActiveCall((call) => {
          const next = call ? { ...call, state: 'connected' as const, startedAt: Date.now() } : null;
          activeCallRef.current = next;
          return next;
        });
      }),
      lease.on('call:candidate', async (payload: { candidate?: RTCIceCandidateInit }) => {
        if (!payload.candidate) return;
        const pc = peerConnectionRef.current;
        if (pc?.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } else {
          pendingCandidatesRef.current.push(payload.candidate);
        }
      }),
      lease.on('call:rejected', () => endCall(false)),
      lease.on('call:ended', () => endCall(false)),
      lease.on('meeting:participants', (payload: { participants?: NexusMeetingParticipant[] }) => {
        setMeetingParticipants(payload.participants ?? []);
      }),
    ];

    return () => {
      const activeCallSnapshot = activeCallRef.current;
      if (activeCallSnapshot?.remoteUserId) {
        lease.emit('call:end', { targetUserId: activeCallSnapshot.remoteUserId });
      }
      const activeMeetingSnapshot = activeMeetingIdRef.current;
      if (activeMeetingSnapshot) {
        lease.emit('meeting:leave', { meetingId: activeMeetingSnapshot });
      }
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      incomingOfferRef.current = null;
      pendingCandidatesRef.current = [];
      if (callTimerRef.current) {
        window.clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
      stopMediaTracks();
      lease.release();
      if (socketRef.current === lease) {
        socketRef.current = null;
      }
    };
  }, [currentUser?.id, currentUser?.tenantId, endCall, stopMediaTracks, stopStreams]);

  useEffect(() => {
    if (activeCall?.state !== 'connected') {
      if (callTimerRef.current) window.clearInterval(callTimerRef.current);
      callTimerRef.current = null;
      return undefined;
    }
    setCallDuration(0);
    callTimerRef.current = window.setInterval(() => {
      setCallDuration((value) => value + 1);
    }, 1000);
    return () => {
      if (callTimerRef.current) window.clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    };
  }, [activeCall?.state]);

  const initiateCall = useCallback(async (recipient: NexusCallPeer, type: NexusCallType, conversationId?: string | null) => {
    const stream = await getMediaStream(type);
    setLocalMediaStream(stream);
    const pc = createPeerConnection(recipient.id);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('call:initiate', {
      recipientId: recipient.id,
      callType: type,
      conversationId,
      signalData: offer,
      callerName: currentUser?.name,
      callerAvatar: currentUser?.avatarUrl || currentUser?.profileImageUrl,
      callerTitle: currentUser?.title,
    });
    const nextCall: NexusActiveCall = {
      state: 'outgoing',
      callType: type,
      remoteUserId: recipient.id,
      remoteUserName: recipient.name,
      remoteUserAvatar: recipient.avatarUrl,
      remoteUserTitle: recipient.title,
      conversationId,
      isInitiator: true,
    };
    activeCallRef.current = nextCall;
    setActiveCall(nextCall);
  }, [createPeerConnection, currentUser?.avatarUrl, currentUser?.name, currentUser?.profileImageUrl, currentUser?.title, getMediaStream, setLocalMediaStream]);

  const acceptCall = useCallback(async (type?: NexusCallType) => {
    if (!activeCall) return;
    const resolvedType = type ?? activeCall.callType;
    const stream = await getMediaStream(resolvedType);
    setLocalMediaStream(stream);
    const pc = createPeerConnection(activeCall.remoteUserId);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    if (incomingOfferRef.current) {
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOfferRef.current));
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socketRef.current?.emit('call:answer', { callerId: activeCall.remoteUserId, signalData: answer });
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      if (candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
    setActiveCall((call) => {
      const next = call ? { ...call, callType: resolvedType, state: 'connected' as const, startedAt: Date.now() } : null;
      activeCallRef.current = next;
      return next;
    });
  }, [activeCall, createPeerConnection, getMediaStream, setLocalMediaStream]);

  const declineCall = useCallback(() => {
    if (activeCall?.remoteUserId) {
      socketRef.current?.emit('call:reject', { callerId: activeCall.remoteUserId });
    }
    endCall(false);
  }, [activeCall?.remoteUserId, endCall]);

  const toggleMute = useCallback(() => {
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    });
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setVideoOff(!track.enabled);
    });
  }, [localStream]);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      setScreenSharing(false);
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];
      const sender = peerConnectionRef.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (sender && screenTrack) {
        await sender.replaceTrack(screenTrack);
      }
      screenTrack.onended = () => setScreenSharing(false);
      setScreenSharing(true);
    } catch (error) {
      console.warn('nexus.call.screen_share_cancelled', error);
    }
  }, [isScreenSharing]);

  const joinMeeting = useCallback(async (meetingId: string, title?: string, conversationId?: string | null) => {
    const stream = await getMediaStream('video');
    setLocalMediaStream(stream);
    setActiveMeetingId(meetingId);
    activeMeetingIdRef.current = meetingId;
    setActiveMeetingTitle(title || `Meeting ${meetingId}`);
    socketRef.current?.emit('meeting:join', {
      meetingId,
      conversationId,
      userInfo: {
        userId: currentUser?.id,
        displayName: currentUser?.name || 'You',
        avatarUrl: currentUser?.avatarUrl || currentUser?.profileImageUrl,
        audioEnabled: true,
        videoEnabled: true,
      },
    });
  }, [currentUser?.avatarUrl, currentUser?.id, currentUser?.name, currentUser?.profileImageUrl, getMediaStream, setLocalMediaStream]);

  const startMeeting = useCallback(async (title?: string, conversationId?: string | null) => {
    const meetingId = `meet_${Date.now().toString(36)}`;
    await joinMeeting(meetingId, title || `${currentUser?.name || 'Zeaplay'} meeting`, conversationId);
  }, [currentUser?.name, joinMeeting]);

  const leaveMeeting = useCallback(() => {
    if (activeMeetingId) {
      socketRef.current?.emit('meeting:leave', { meetingId: activeMeetingId });
    }
    stopStreams();
    activeMeetingIdRef.current = null;
    setActiveMeetingId(null);
    setActiveMeetingTitle(null);
    setMeetingParticipants([]);
    setMuted(false);
    setVideoOff(false);
    setScreenSharing(false);
  }, [activeMeetingId, stopStreams]);

  useEffect(() => {
    if (!activeMeetingId) return;
    socketRef.current?.emit('meeting:media_state', {
      meetingId: activeMeetingId,
      audioEnabled: !isMuted,
      videoEnabled: !isVideoOff,
      screenSharing: isScreenSharing,
    });
  }, [activeMeetingId, isMuted, isScreenSharing, isVideoOff]);

  return useMemo(() => ({
    connected,
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
  }), [
    acceptCall,
    activeCall,
    activeMeetingId,
    activeMeetingTitle,
    callDuration,
    connected,
    declineCall,
    endCall,
    initiateCall,
    isMuted,
    isScreenSharing,
    isVideoOff,
    joinMeeting,
    leaveMeeting,
    localStream,
    meetingParticipants,
    remoteStream,
    startMeeting,
    toggleMute,
    toggleScreenShare,
    toggleVideo,
  ]);
};
