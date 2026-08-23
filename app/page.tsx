'use client';

import {
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
} from 'livekit-client';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'lobby' | 'joining' | 'connecting' | 'waiting' | 'watching' | 'error';
type Profile = { name: string; avatar: string };
type ChatMessage = { id: string; kind: 'chat' | 'system'; text: string; timestamp: number; profile?: Profile };
type TokenResponse = { serverUrl: string; roomName: string; token: string; error?: string };
type RoomPacket = { type?: 'chat' | 'hello' | 'history'; message?: unknown; messages?: unknown[] };
type VideoRtpStats = RTCStats & {
  bytesReceived?: number;
  codecId?: string;
  freezeCount?: number;
  frameHeight?: number;
  framesDecoded?: number;
  framesDropped?: number;
  framesPerSecond?: number;
  framesReceived?: number;
  framesRendered?: number;
  frameWidth?: number;
  jitter?: number;
  keyFramesDecoded?: number;
  kind?: string;
  mediaType?: string;
  nackCount?: number;
  packetsLost?: number;
  packetsReceived?: number;
  pliCount?: number;
  retransmittedPacketsReceived?: number;
  totalDecodeTime?: number;
  totalFreezesDuration?: number;
};
type CandidatePairStats = RTCStats & { currentRoundTripTime?: number; localCandidateId?: string; nominated?: boolean; remoteCandidateId?: string; state?: string };
type CandidateStats = RTCStats & { candidateType?: string; networkType?: string; protocol?: string };
type TransportStats = RTCStats & { selectedCandidatePairId?: string };
type DiagnosticSample = {
  at: string;
  bitrateMbps: number | null;
  candidateType: string | null;
  decodedFps: number | null;
  droppedFps: number | null;
  framesDecoded: number;
  framesDropped: number;
  framesReceived: number;
  jitterMs: number | null;
  packetLossPercent: number | null;
  packetsLost: number;
  packetsReceived: number;
  receivedFps: number | null;
  renderFps: number | null;
  roundTripMs: number | null;
  routeProtocol: string | null;
};

const ROOM_NAME = 'cineleo-palco';
const CHAT_TOPIC = 'cineleo-chat';
const hostProfile: Profile = { name: 'Léo · Anfitrião', avatar: '' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function safeAvatar(value: unknown) {
  if (typeof value !== 'string') return '';
  const avatar = value.trim().slice(0, 12_000);
  return /^(https?:\/\/|data:image\/)/i.test(avatar) ? avatar : '';
}

function safeProfile(value: unknown, fallback = 'Convidado'): Profile {
  const candidate = value as Partial<Profile> | null;
  const name = typeof candidate?.name === 'string' ? candidate.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) : '';
  return { name: name || fallback, avatar: safeAvatar(candidate?.avatar) };
}

function normalizeMessage(value: unknown): ChatMessage | null {
  const candidate = value as Partial<ChatMessage> | null;
  if (!candidate || typeof candidate.text !== 'string') return null;
  const text = candidate.text.trim().slice(0, 500);
  if (!text) return null;
  return {
    id: typeof candidate.id === 'string' ? candidate.id.slice(0, 80) : crypto.randomUUID(),
    kind: candidate.kind === 'system' ? 'system' : 'chat',
    text,
    timestamp: typeof candidate.timestamp === 'number' ? candidate.timestamp : Date.now(),
    profile: candidate.kind === 'system' ? undefined : safeProfile(candidate.profile),
  };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CL';
}

function summarizeSeries(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { average: null, median: null, onePercentLow: null, variance: null };
  const average = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + ((value - average) ** 2), 0) / sorted.length;
  return {
    average: Number(average.toFixed(2)),
    median: Number(sorted[Math.floor((sorted.length - 1) * 0.5)].toFixed(2)),
    onePercentLow: Number(sorted[Math.floor((sorted.length - 1) * 0.01)].toFixed(2)),
    variance: Number(variance.toFixed(3)),
  };
}

function Avatar({ profile, large = false }: { profile: Profile; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile.avatar]);
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-label={profile.name}>{profile.avatar && !failed ? <img src={profile.avatar} alt="" onError={() => setFailed(true)} /> : initials(profile.name)}</span>;
}

async function avatarFromFile(file: File) {
  if (file.size > 8_000_000) throw new Error('Escolha uma imagem de até 8 MB.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Não foi possível abrir essa imagem.'));
      element.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar essa imagem.');
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, 96, 96);
    const avatar = canvas.toDataURL('image/jpeg', 0.68);
    return avatar.length <= 12_000 ? avatar : '';
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>('lobby');
  const [roomId, setRoomId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [message, setMessage] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestAvatar, setGuestAvatar] = useState('');
  const [guestProfile, setGuestProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState('');
  const [voicePlaybackBlocked, setVoicePlaybackBlocked] = useState(false);
  const [actualFps, setActualFps] = useState<number | null>(null);
  const [networkFps, setNetworkFps] = useState<number | null>(null);
  const [decodedFps, setDecodedFps] = useState<number | null>(null);
  const [renderFps, setRenderFps] = useState<number | null>(null);
  const [displayRefreshHz, setDisplayRefreshHz] = useState<number | null>(null);
  const [bitrateMbps, setBitrateMbps] = useState<number | null>(null);
  const [packetLossPercent, setPacketLossPercent] = useState<number | null>(null);
  const [jitterMs, setJitterMs] = useState<number | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [routeProtocol, setRouteProtocol] = useState<string | null>(null);
  const [candidateType, setCandidateType] = useState<string | null>(null);
  const [codec, setCodec] = useState<string | null>(null);
  const [actualResolution, setActualResolution] = useState<string | null>(null);
  const [framesReceived, setFramesReceived] = useState(0);
  const [framesDecoded, setFramesDecoded] = useState(0);
  const [framesDropped, setFramesDropped] = useState(0);
  const [droppedFps, setDroppedFps] = useState<number | null>(null);
  const [freezeCount, setFreezeCount] = useState(0);
  const [freezeDuration, setFreezeDuration] = useState(0);
  const [keyFramesDecoded, setKeyFramesDecoded] = useState(0);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [packetsLost, setPacketsLost] = useState(0);
  const [nackCount, setNackCount] = useState(0);
  const [retransmittedPackets, setRetransmittedPackets] = useState(0);
  const [pliCount, setPliCount] = useState(0);
  const [decodeTimeMs, setDecodeTimeMs] = useState<number | null>(null);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [connectionQuality, setConnectionQuality] = useState('CONECTANDO');

  const roomRef = useRef<Room | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoTrackRef = useRef<RemoteTrack | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteAudioRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const mutedRef = useRef(true);
  const currentProfileRef = useRef<Profile>(hostProfile);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const statsTimerRef = useRef<number | null>(null);
  const diagnosticSamplesRef = useRef<DiagnosticSample[]>([]);
  const renderFpsRef = useRef<number | null>(null);
  const manualDisconnectRef = useRef(false);

  const replaceChat = useCallback((messages: ChatMessage[]) => {
    const next = messages.slice(-120);
    chatMessagesRef.current = next;
    setChatMessages(next);
  }, []);

  const appendChat = useCallback((messageToAdd: ChatMessage) => {
    setChatMessages((current) => {
      if (current.some((item) => item.id === messageToAdd.id)) return current;
      const next = [...current, messageToAdd].slice(-120);
      chatMessagesRef.current = next;
      return next;
    });
  }, []);

  const publishPacket = useCallback(async (packet: RoomPacket, destinationIdentities?: string[]) => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.publishData(encoder.encode(JSON.stringify(packet)), {
      reliable: true,
      topic: CHAT_TOPIC,
      destinationIdentities,
    });
  }, []);

  const updateViewerCount = useCallback((room: Room) => {
    const audience = Array.from(room.remoteParticipants.values()).filter((participant) => participant.identity !== 'cineleo-studio').length;
    setViewerCount(audience + (isHost ? 0 : 1));
  }, [isHost]);

  const stopStats = useCallback(() => {
    if (statsTimerRef.current) window.clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
  }, []);

  const startStats = useCallback((track: RemoteTrack) => {
    stopStats();
    let previousBytes = 0;
    let previousFramesDecoded = 0;
    let previousFramesDropped = 0;
    let previousFramesReceived = 0;
    let previousPacketsLost = 0;
    let previousPacketsReceived = 0;
    let previousTime = performance.now();
    statsTimerRef.current = window.setInterval(async () => {
      const report = await track.getRTCStatsReport().catch(() => undefined);
      if (!report) return;
      const now = performance.now();
      const elapsedSeconds = Math.max(0.001, (now - previousTime) / 1000);
      let sampleReceivedFps: number | null = null;
      let sampleDecodedFps: number | null = null;
      let sampleDroppedFps: number | null = null;
      let sampleBitrate: number | null = null;
      let sampleLoss: number | null = null;
      let sampleJitter: number | null = null;
      let sampleRtt: number | null = null;
      let sampleProtocol: string | null = null;
      let sampleCandidate: string | null = null;
      let sampleFramesReceived = 0;
      let sampleFramesDecoded = 0;
      let sampleFramesDropped = 0;
      let samplePacketsReceived = 0;
      let samplePacketsLost = 0;
      let selectedCandidatePairId = '';
      report.forEach((entry) => {
        const transport = entry as TransportStats;
        if (transport.type === 'transport' && transport.selectedCandidatePairId) selectedCandidatePairId = transport.selectedCandidatePairId;
      });
      report.forEach((entry) => {
        const stat = entry as VideoRtpStats;
        if (stat.type !== 'inbound-rtp' || (stat.kind ?? stat.mediaType) !== 'video') return;
        if (typeof stat.framesReceived === 'number') {
          sampleFramesReceived = stat.framesReceived;
          setFramesReceived(stat.framesReceived);
          if (previousFramesReceived > 0) sampleReceivedFps = (stat.framesReceived - previousFramesReceived) / elapsedSeconds;
        } else if (typeof stat.framesPerSecond === 'number') {
          sampleReceivedFps = stat.framesPerSecond;
        }
        if (typeof stat.framesDecoded === 'number') {
          sampleFramesDecoded = stat.framesDecoded;
          setFramesDecoded(stat.framesDecoded);
          if (previousFramesDecoded > 0) sampleDecodedFps = (stat.framesDecoded - previousFramesDecoded) / elapsedSeconds;
        }
        if (typeof stat.framesDropped === 'number') {
          sampleFramesDropped = stat.framesDropped;
          setFramesDropped(stat.framesDropped);
          if (previousFramesDropped > 0) sampleDroppedFps = Math.max(0, (stat.framesDropped - previousFramesDropped) / elapsedSeconds);
        }
        if (sampleReceivedFps !== null) setNetworkFps(Number(sampleReceivedFps.toFixed(1)));
        if (sampleDecodedFps !== null) setDecodedFps(Number(sampleDecodedFps.toFixed(1)));
        if (sampleDroppedFps !== null) setDroppedFps(Number(sampleDroppedFps.toFixed(1)));
        if (stat.frameWidth && stat.frameHeight) setActualResolution(`${stat.frameWidth}×${stat.frameHeight}`);
        if (typeof stat.freezeCount === 'number') setFreezeCount(stat.freezeCount);
        if (typeof stat.totalFreezesDuration === 'number') setFreezeDuration(stat.totalFreezesDuration);
        if (typeof stat.keyFramesDecoded === 'number') setKeyFramesDecoded(stat.keyFramesDecoded);
        if (typeof stat.nackCount === 'number') setNackCount(stat.nackCount);
        if (typeof stat.pliCount === 'number') setPliCount(stat.pliCount);
        if (typeof stat.retransmittedPacketsReceived === 'number') setRetransmittedPackets(stat.retransmittedPacketsReceived);
        if (typeof stat.totalDecodeTime === 'number' && stat.framesDecoded) {
          setDecodeTimeMs(Number(((stat.totalDecodeTime * 1000) / stat.framesDecoded).toFixed(2)));
        }
        if (typeof stat.jitter === 'number') {
          sampleJitter = Math.round(stat.jitter * 1000);
          setJitterMs(sampleJitter);
        }
        if (stat.codecId) {
          const codecStat = report.get(stat.codecId) as { mimeType?: string } | undefined;
          if (codecStat?.mimeType) setCodec(codecStat.mimeType.replace('video/', '').toUpperCase());
        }
        if (typeof stat.bytesReceived === 'number' && previousBytes > 0) {
          sampleBitrate = Number((((stat.bytesReceived - previousBytes) * 8) / elapsedSeconds / 1_000_000).toFixed(2));
          setBitrateMbps(sampleBitrate);
        }
        if (typeof stat.bytesReceived === 'number') previousBytes = stat.bytesReceived;
        if (typeof stat.packetsLost === 'number' && typeof stat.packetsReceived === 'number') {
          const lost = Math.max(0, stat.packetsLost - previousPacketsLost);
          const received = Math.max(0, stat.packetsReceived - previousPacketsReceived);
          if (previousPacketsReceived > 0 && lost + received > 0) {
            sampleLoss = Number(((lost / (lost + received)) * 100).toFixed(2));
            setPacketLossPercent(sampleLoss);
          }
          samplePacketsLost = stat.packetsLost;
          samplePacketsReceived = stat.packetsReceived;
          setPacketsLost(stat.packetsLost);
          setPacketsReceived(stat.packetsReceived);
          previousPacketsLost = stat.packetsLost;
          previousPacketsReceived = stat.packetsReceived;
        }
        if (typeof stat.framesReceived === 'number') previousFramesReceived = stat.framesReceived;
        if (typeof stat.framesDecoded === 'number') previousFramesDecoded = stat.framesDecoded;
        if (typeof stat.framesDropped === 'number') previousFramesDropped = stat.framesDropped;
      });
      report.forEach((entry) => {
        const pair = entry as CandidatePairStats;
        if (pair.type !== 'candidate-pair' || pair.state !== 'succeeded' || (!pair.nominated && pair.id !== selectedCandidatePairId)) return;
        if (typeof pair.currentRoundTripTime === 'number') {
          sampleRtt = Math.round(pair.currentRoundTripTime * 1000);
          setRoundTripMs(sampleRtt);
        }
        if (pair.localCandidateId) {
          const candidate = report.get(pair.localCandidateId) as CandidateStats | undefined;
          if (candidate?.protocol) {
            sampleProtocol = candidate.protocol.toUpperCase();
            setRouteProtocol(sampleProtocol);
          }
          if (candidate?.candidateType) {
            sampleCandidate = candidate.candidateType.toUpperCase();
            setCandidateType(sampleCandidate);
          }
        }
      });
      previousTime = now;
      diagnosticSamplesRef.current = [...diagnosticSamplesRef.current, {
        at: new Date().toISOString(),
        bitrateMbps: sampleBitrate,
        candidateType: sampleCandidate,
        decodedFps: sampleDecodedFps === null ? null : Number(sampleDecodedFps.toFixed(2)),
        droppedFps: sampleDroppedFps === null ? null : Number(sampleDroppedFps.toFixed(2)),
        framesDecoded: sampleFramesDecoded,
        framesDropped: sampleFramesDropped,
        framesReceived: sampleFramesReceived,
        jitterMs: sampleJitter,
        packetLossPercent: sampleLoss,
        packetsLost: samplePacketsLost,
        packetsReceived: samplePacketsReceived,
        receivedFps: sampleReceivedFps === null ? null : Number(sampleReceivedFps.toFixed(2)),
        renderFps: renderFpsRef.current,
        roundTripMs: sampleRtt,
        routeProtocol: sampleProtocol,
      }].slice(-900);
    }, 1000);
  }, [stopStats]);

  const attachTrack = useCallback((track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) {
      videoTrackRef.current?.detach();
      videoTrackRef.current = track;
      if (videoRef.current) {
        track.attach(videoRef.current);
        videoRef.current.muted = true;
        videoRef.current.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
      }
      const settings = track.mediaStreamTrack.getSettings();
      if (settings.frameRate) setActualFps(Math.round(settings.frameRate));
      if (settings.width && settings.height) setActualResolution(`${settings.width}×${settings.height}`);
      setPhase('watching');
      setMessage('');
      startStats(track);
      return;
    }
    if (track.kind === Track.Kind.Audio) {
      const element = track.attach();
      element.muted = mutedRef.current;
      element.autoplay = true;
      element.className = 'remote-room-audio';
      remoteAudioRef.current.set(track.sid ?? track.mediaStreamTrack.id, element);
      audioContainerRef.current?.appendChild(element);
      element.play().then(() => setVoicePlaybackBlocked(false)).catch(() => setVoicePlaybackBlocked(true));
    }
  }, [startStats]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('room');
    if (!id) return;
    const hostOnThisDevice = window.localStorage.getItem('cineleo-host-device') === '1';
    setRoomId(ROOM_NAME);
    if (hostOnThisDevice) {
      setIsHost(true);
      setGuestProfile(hostProfile);
      currentProfileRef.current = hostProfile;
      setPhase('connecting');
    } else {
      setPhase('joining');
    }
  }, []);

  useEffect(() => {
    const profile = guestProfile;
    if (!roomId || !profile) return;
    let cancelled = false;
    manualDisconnectRef.current = false;
    setPhase('connecting');
    setMessage('Abrindo as portas da sala…');
    setConnectionQuality('CONECTANDO');
    currentProfileRef.current = profile;

    const room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
    roomRef.current = room;

    const onTrackSubscribed = (track: RemoteTrack) => attachTrack(track);
    const onTrackUnsubscribed = (track: RemoteTrack) => {
      track.detach();
      if (track.kind === Track.Kind.Video && videoTrackRef.current === track) {
        stopStats();
        videoTrackRef.current = null;
        setPhase('waiting');
        setMessage('O projetor está ligado. Aguardando o CineLéo Studio…');
      }
      const trackKey = track.sid ?? track.mediaStreamTrack.id;
      const audio = remoteAudioRef.current.get(trackKey);
      if (audio) {
        audio.remove();
        remoteAudioRef.current.delete(trackKey);
      }
    };
    const onParticipantConnected = (participant: RemoteParticipant) => {
      updateViewerCount(room);
      if (participant.identity !== 'cineleo-studio') {
        appendChat({ id: crypto.randomUUID(), kind: 'system', text: `${participant.name || 'Um convidado'} entrou na sala.`, timestamp: Date.now() });
      }
    };
    const onParticipantDisconnected = (participant: RemoteParticipant) => {
      updateViewerCount(room);
      if (participant.identity !== 'cineleo-studio') {
        appendChat({ id: crypto.randomUUID(), kind: 'system', text: `${participant.name || 'Um convidado'} saiu da sala.`, timestamp: Date.now() });
      }
    };
    const onDataReceived = (payload: Uint8Array, participant?: Participant, _kind?: unknown, topic?: string) => {
      if (topic !== CHAT_TOPIC) return;
      try {
        const packet = JSON.parse(decoder.decode(payload)) as RoomPacket;
        if (packet.type === 'chat') {
          const incoming = normalizeMessage(packet.message);
          if (incoming) appendChat(incoming);
        } else if (packet.type === 'history' && Array.isArray(packet.messages)) {
          replaceChat(packet.messages.map(normalizeMessage).filter((item): item is ChatMessage => Boolean(item)));
        } else if (packet.type === 'hello' && isHost && participant) {
          void publishPacket({ type: 'history', messages: chatMessagesRef.current }, [participant.identity]);
        }
      } catch {
        // Pacotes inválidos são ignorados sem interromper a sessão.
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      .on(RoomEvent.ParticipantConnected, onParticipantConnected)
      .on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      .on(RoomEvent.DataReceived, onDataReceived)
      .on(RoomEvent.Reconnecting, () => { setConnectionQuality('RECONECTANDO'); setMessage('Reconectando ao projetor…'); })
      .on(RoomEvent.Reconnected, () => { setConnectionQuality('ESTÁVEL'); if (!videoTrackRef.current) setMessage('O projetor está ligado. Aguardando o CineLéo Studio…'); })
      .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => { if (participant.isLocal) setConnectionQuality(String(quality).toUpperCase()); })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setVoicePlaybackBlocked(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, () => {
        if (!manualDisconnectRef.current && !cancelled) {
          setPhase('error');
          setMessage('A conexão com a sala foi encerrada. Atualize a página para entrar novamente.');
        }
      });

    void (async () => {
      try {
        const response = await fetch('/api/livekit-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: profile.name, role: isHost ? 'host' : 'guest' }),
        });
        const credentials = await response.json() as TokenResponse;
        if (!response.ok || !credentials.token) throw new Error(credentials.error || 'Não foi possível validar o ingresso.');
        await room.connect(credentials.serverUrl, credentials.token, { autoSubscribe: true });
        if (cancelled) return;
        updateViewerCount(room);
        setConnectionQuality('ESTÁVEL');
        setPhase(videoTrackRef.current ? 'watching' : 'waiting');
        setMessage(videoTrackRef.current ? '' : 'O projetor está ligado. Aguardando o CineLéo Studio…');
        if (isHost) {
          replaceChat([{ id: crypto.randomUUID(), kind: 'system', text: 'A cabine abriu. O chat e a voz já estão disponíveis.', timestamp: Date.now() }]);
        } else {
          await publishPacket({ type: 'hello' });
        }
      } catch (error) {
        if (cancelled) return;
        setPhase('error');
        setMessage(error instanceof Error ? error.message : 'Não foi possível conectar à sala.');
      }
    })();

    return () => {
      cancelled = true;
      stopStats();
      room.removeAllListeners();
      room.disconnect();
      videoTrackRef.current?.detach();
      remoteAudioRef.current.forEach((element) => element.remove());
      remoteAudioRef.current.clear();
      if (roomRef.current === room) roomRef.current = null;
    };
  }, [appendChat, attachTrack, guestProfile, isHost, publishPacket, replaceChat, roomId, stopStats, updateViewerCount]);

  useEffect(() => {
    if (videoRef.current && videoTrackRef.current) videoTrackRef.current.attach(videoRef.current);
  }, [phase]);
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== 'watching' || !video || typeof video.requestVideoFrameCallback !== 'function') {
      renderFpsRef.current = null;
      setRenderFps(null);
      return;
    }
    let cancelled = false;
    let requestId = 0;
    let frames = 0;
    let startedAt = performance.now();
    const measure = (now: number) => {
      if (cancelled) return;
      frames += 1;
      const elapsed = now - startedAt;
      if (elapsed >= 1000) {
        const measured = Number(((frames * 1000) / elapsed).toFixed(1));
        renderFpsRef.current = measured;
        setRenderFps(measured);
        frames = 0;
        startedAt = now;
      }
      requestId = video.requestVideoFrameCallback(measure);
    };
    requestId = video.requestVideoFrameCallback(measure);
    return () => {
      cancelled = true;
      if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(requestId);
    };
  }, [phase]);
  useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    let frames = 0;
    const startedAt = performance.now();
    const measureRefresh = (now: number) => {
      if (cancelled) return;
      frames += 1;
      const elapsed = now - startedAt;
      if (elapsed >= 1800) {
        setDisplayRefreshHz(Math.round((frames * 1000) / elapsed));
        return;
      }
      requestId = window.requestAnimationFrame(measureRefresh);
    };
    requestId = window.requestAnimationFrame(measureRefresh);
    return () => { cancelled = true; window.cancelAnimationFrame(requestId); };
  }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [chatMessages]);

  const startHosting = () => {
    window.localStorage.setItem('cineleo-host-device', '1');
    window.history.replaceState({}, '', `${window.location.pathname}?room=${ROOM_NAME}`);
    setIsHost(true);
    setRoomId(ROOM_NAME);
    setGuestProfile(hostProfile);
    currentProfileRef.current = hostProfile;
    setPhase('connecting');
  };

  const leaveRoom = () => {
    manualDisconnectRef.current = true;
    roomRef.current?.disconnect();
    roomRef.current = null;
    stopStats();
    videoTrackRef.current?.detach();
    videoTrackRef.current = null;
    remoteAudioRef.current.forEach((element) => element.remove());
    remoteAudioRef.current.clear();
    window.localStorage.removeItem('cineleo-host-device');
    window.history.replaceState({}, '', window.location.pathname);
    replaceChat([]);
    setGuestProfile(null);
    setRoomId('');
    setIsHost(false);
    setPhase('lobby');
    setMessage('');
    setMicEnabled(false);
    setActualFps(null);
    setNetworkFps(null);
    setDecodedFps(null);
    setRenderFps(null);
    renderFpsRef.current = null;
    setBitrateMbps(null);
    setPacketLossPercent(null);
    setJitterMs(null);
    setRoundTripMs(null);
    setRouteProtocol(null);
    setCandidateType(null);
    setActualResolution(null);
    setCodec(null);
    setFramesReceived(0);
    setFramesDecoded(0);
    setFramesDropped(0);
    setDroppedFps(null);
    setFreezeCount(0);
    setFreezeDuration(0);
    setKeyFramesDecoded(0);
    setPacketsReceived(0);
    setPacketsLost(0);
    setNackCount(0);
    setRetransmittedPackets(0);
    setPliCount(0);
    setDecodeTimeMs(null);
    diagnosticSamplesRef.current = [];
  };

  const joinRoom = (event: FormEvent) => {
    event.preventDefault();
    const name = guestName.trim().slice(0, 24);
    if (!name) { setProfileError('Digite seu nome para entrar na sessão.'); return; }
    setProfileError('');
    setGuestProfile(safeProfile({ name, avatar: guestAvatar }, name));
  };

  const chooseAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarBusy(true);
    setProfileError('');
    try {
      const avatar = await avatarFromFile(file);
      if (!avatar) throw new Error('A foto ficou grande demais. Tente outra imagem.');
      setGuestAvatar(avatar);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Não foi possível preparar a foto.');
    } finally {
      setAvatarBusy(false);
      event.target.value = '';
    }
  };

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}?room=${ROOM_NAME}` : '';
  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const sendChat = async (event: FormEvent) => {
    event.preventDefault();
    const text = chatInput.trim().slice(0, 500);
    if (!text || !roomRef.current) return;
    const chatMessage: ChatMessage = { id: crypto.randomUUID(), kind: 'chat', text, timestamp: Date.now(), profile: currentProfileRef.current };
    appendChat(chatMessage);
    setChatInput('');
    await publishPacket({ type: 'chat', message: chatMessage }).catch(() => setMicError('A mensagem não pôde ser enviada. Tente novamente.'));
  };

  const toggleMute = async () => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    remoteAudioRef.current.forEach((element) => { element.muted = nextMuted; });
    if (!nextMuted) {
      try {
        await roomRef.current?.startAudio();
        await Promise.all(Array.from(remoteAudioRef.current.values(), (element) => element.play()));
        setVoicePlaybackBlocked(false);
      } catch {
        setVoicePlaybackBlocked(true);
      }
    }
  };

  const resumePlayback = async () => {
    try {
      await roomRef.current?.startVideo();
      await roomRef.current?.startAudio();
      await videoRef.current?.play();
      mutedRef.current = false;
      setMuted(false);
      remoteAudioRef.current.forEach((element) => { element.muted = false; void element.play(); });
      setPlaybackBlocked(false);
      setVoicePlaybackBlocked(false);
    } catch {
      setPlaybackBlocked(true);
    }
  };

  const toggleMicrophone = async () => {
    const room = roomRef.current;
    if (!room) return;
    setMicError('');
    try {
      const nextEnabled = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(nextEnabled, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      setMicEnabled(nextEnabled);
    } catch {
      setMicError('Não foi possível ligar o microfone. Confira a permissão do navegador.');
    }
  };

  const resumeVoicePlayback = async () => {
    try {
      await roomRef.current?.startAudio();
      await Promise.all(Array.from(remoteAudioRef.current.values(), (element) => element.play()));
      setVoicePlaybackBlocked(false);
    } catch {
      setVoicePlaybackBlocked(true);
    }
  };

  const downloadDiagnostic = () => {
    const samples = diagnosticSamplesRef.current;
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      viewer: {
        userAgent: navigator.userAgent,
        displayRefreshHz,
      },
      stream: {
        resolution: actualResolution,
        codec,
        receivedFps: networkFps,
        decodedFps,
        renderedFps: renderFps,
        framesReceived,
        framesDecoded,
        framesDropped,
        droppedFps,
        freezeCount,
        totalFreezesDuration: freezeDuration,
        keyFramesDecoded,
        bitrateMbps,
        packetsReceived,
        packetsLost,
        packetLossPercent,
        nackCount,
        retransmittedPacketsReceived: retransmittedPackets,
        pliCount,
        jitterMs,
        roundTripMs,
        transport: routeProtocol,
        candidateType,
        averageDecodeTimeMs: decodeTimeMs,
      },
      stability: {
        receivedFps: summarizeSeries(samples.map((sample) => sample.receivedFps)),
        decodedFps: summarizeSeries(samples.map((sample) => sample.decodedFps)),
        renderedFps: summarizeSeries(samples.map((sample) => sample.renderFps)),
      },
      samples,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `salynhah-viewer-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const fullscreen = () => videoRef.current?.requestFullscreen().catch(() => undefined);
  const pictureInPicture = () => { if (videoRef.current && document.pictureInPictureEnabled) videoRef.current.requestPictureInPicture().catch(() => undefined); };

  if (phase !== 'lobby') {
    const connected = phase === 'waiting' || phase === 'watching';
    const roomActive = phase === 'watching';
    const displayProfile = isHost ? hostProfile : (guestProfile ?? safeProfile({ name: guestName, avatar: guestAvatar }));
    const status = isHost ? (roomActive ? `AO VIVO · ${networkFps ?? '—'} FPS` : connected ? 'CABINE ABERTA' : 'CONECTANDO') : roomActive ? 'EM EXIBIÇÃO' : phase === 'joining' ? 'BILHETERIA' : phase === 'error' ? 'SEM SINAL' : 'AGUARDANDO';
    const diagnosticWarning = packetLossPercent !== null && packetLossPercent >= 1
      ? `A rota está perdendo ${packetLossPercent}% dos pacotes. Use o perfil 1080p60 Estável ou teste uma conexão por cabo.`
      : jitterMs !== null && jitterMs >= 30
        ? `A variação da rede está alta (${jitterMs} ms de jitter). Isso causa FPS irregular mesmo com muitos megabits disponíveis.`
        : decodedFps !== null && networkFps !== null && networkFps - decodedFps >= 8
          ? 'Os quadros chegam, mas o decoder deste aparelho não acompanha a transmissão.'
          : renderFps !== null && decodedFps !== null && decodedFps - renderFps >= 8
            ? 'O decoder acompanha, mas o compositor ou o refresh deste monitor limita a exibição.'
          : '';
    return (
      <main className="screening-room">
        <header className="screening-bar">
          <a className="brand light" href={typeof window !== 'undefined' ? window.location.pathname : '/'}><span className="brand-mark">CL</span><span>CINELÉO</span></a>
          <div className="live-status"><span className={roomActive ? 'live-dot' : 'wait-dot'} /> {status}</div>
          <div className="audience">◉ {isHost ? `${viewerCount} ESPECTADOR${viewerCount === 1 ? '' : 'ES'}` : phase === 'joining' ? 'CONVITE PRIVADO' : displayProfile.name}</div>
        </header>
        <section className="theatre">
          <div className="curtain curtain-left" /><div className="curtain curtain-right" />
          <div className={`cinema-grid ${phase === 'joining' ? 'entry-layout' : ''}`}>
            <div className="projection-column">
              <div className={`screen-frame ${phase === 'joining' ? 'join-screen' : ''}`}>
                <div className="screen-label"><span>{phase === 'joining' ? 'ACESSO À SESSÃO' : isHost ? 'MONITOR DA CABINE' : 'SESSÃO PARTICULAR'}</span><span>{actualResolution ?? 'FULL HD'} · {networkFps ?? actualFps ?? '—'} FPS · LIVEKIT SFU</span></div>
                {phase === 'joining' && <form className="guest-entry-card" onSubmit={joinRoom}>
                  <div className="entry-copy"><span className="entry-kicker">SEU INGRESSO</span><h1>Quem está<br/><em>entrando?</em></h1><p>Escolha como seu nome e sua foto vão aparecer no chat da sala.</p></div>
                  <div className="entry-form">
                    <div className="profile-preview"><Avatar profile={displayProfile} large /><div><strong>{guestName.trim() || 'Seu nome'}</strong><small>CONVIDADO DA SESSÃO</small></div></div>
                    <label className="entry-label" htmlFor="guest-name">SEU NOME *</label>
                    <input id="guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={24} autoComplete="name" placeholder="Como devemos chamar você?" autoFocus />
                    <label className="entry-label" htmlFor="avatar-url">FOTO <span>OPCIONAL</span></label>
                    <input id="avatar-url" type="url" value={guestAvatar.startsWith('data:') ? '' : guestAvatar} onChange={(event) => setGuestAvatar(event.target.value)} placeholder="Cole o link de uma foto" />
                    <div className="avatar-actions"><span>OU</span><label className="upload-avatar">{avatarBusy ? 'PREPARANDO FOTO…' : '↑ ESCOLHER DO APARELHO'}<input type="file" accept="image/*" onChange={chooseAvatar} disabled={avatarBusy} /></label>{guestAvatar && <button type="button" onClick={() => setGuestAvatar('')}>REMOVER</button>}</div>
                    {profileError && <p className="profile-error">{profileError}</p>}
                    <button className="enter-room-button" type="submit" disabled={avatarBusy}>ENTRAR NA SESSÃO <span>→</span></button>
                    <small className="entry-privacy">Nada é salvo. Seu perfil existe somente durante esta sessão.</small>
                  </div>
                </form>}
                {(phase === 'connecting' || phase === 'waiting' || phase === 'error') && <div className="waiting-card"><div className="projector-beam">CL</div><p>{message}</p><small>{phase === 'waiting' ? 'Mantenha esta página aberta. A imagem começa automaticamente quando o Studio entrar no ar.' : phase === 'connecting' ? 'Validando seu ingresso e procurando a melhor rota de conexão.' : 'Confira o endereço com quem enviou o convite.'}</small></div>}
                <video ref={videoRef} className={roomActive ? 'visible' : ''} autoPlay playsInline muted />
                {roomActive && playbackBlocked && <button className="playback-gate" onClick={resumePlayback}><strong>▶ INICIAR EXIBIÇÃO</strong><small>Clique para liberar o vídeo e o áudio</small></button>}
                <div ref={audioContainerRef} className="audio-stage" aria-hidden="true" />
              </div>
              {connected && <div className="player-controls">
                <button onClick={toggleMute} aria-label={muted ? 'Ativar áudio da transmissão' : 'Silenciar transmissão'}>{muted ? '◌' : '◉'} <span>{muted ? 'ÁUDIO DESLIGADO' : 'ÁUDIO DA SALA'}</span></button>
                <button className={micEnabled ? 'mic-active' : ''} onClick={toggleMicrophone} aria-label={micEnabled ? 'Desligar microfone' : 'Ligar microfone'}>{micEnabled ? '●' : '♬'} <span>{micEnabled ? 'MICROFONE LIGADO' : 'FALAR NA SALA'}</span></button>
                {!isHost && roomActive && <button onClick={pictureInPicture} aria-label="Picture in picture">▣ <span>MINIPLAYER</span></button>}
                {roomActive && <button onClick={fullscreen} aria-label="Tela cheia">⛶ <span>TELA CHEIA</span></button>}
                {connected && <button className={diagnosticExpanded ? 'diagnostic-active' : ''} onClick={() => setDiagnosticExpanded((value) => !value)} aria-expanded={diagnosticExpanded}>⌁ <span>DIAGNÓSTICO</span></button>}
              </div>}
              {micError && <p className="voice-notice error">{micError}</p>}
              {voicePlaybackBlocked && <button className="voice-notice" onClick={resumeVoicePlayback}>▶ CLIQUE PARA OUVIR AS VOZES DA SALA</button>}
              {connected && <div className="stream-metrics" aria-label="Diagnóstico da transmissão">
                <span><small>RECEBIDO</small><strong>{networkFps ?? actualFps ?? '—'} FPS</strong></span><span><small>DECODIFICADO</small><strong>{decodedFps ?? '—'} FPS</strong></span><span><small>EXIBIDO</small><strong>{renderFps ?? '—'} FPS</strong></span><span><small>RESOLUÇÃO / CODEC</small><strong>{actualResolution ?? 'AGUARDANDO'} · {codec ?? '—'}</strong></span><span><small>REDE</small><strong>{bitrateMbps !== null ? `${bitrateMbps} Mb/s` : '—'} · {packetLossPercent !== null ? `${packetLossPercent}% perda` : 'medindo'}</strong></span><span><small>ROTA / LATÊNCIA</small><strong>{routeProtocol ?? '—'} · {candidateType ?? '—'}{roundTripMs !== null ? ` · ${roundTripMs} ms` : jitterMs !== null ? ` · jitter ${jitterMs} ms` : ''}</strong></span>
              </div>}
              {connected && diagnosticExpanded && <section className="diagnostic-panel" aria-label="Modo diagnóstico detalhado">
                <header><div><span>MODO DIAGNÓSTICO</span><strong>Frames reais em cada etapa do viewer</strong></div><button type="button" onClick={downloadDiagnostic}>↓ BAIXAR JSON</button></header>
                <div className="diagnostic-grid">
                  <span><small>FRAMES RECEBIDOS</small><strong>{framesReceived.toLocaleString('pt-BR')}</strong></span>
                  <span><small>FRAMES DECODIFICADOS</small><strong>{framesDecoded.toLocaleString('pt-BR')}</strong></span>
                  <span><small>FRAMES DESCARTADOS</small><strong>{framesDropped.toLocaleString('pt-BR')} · {droppedFps ?? '—'}/s</strong></span>
                  <span><small>KEYFRAMES</small><strong>{keyFramesDecoded.toLocaleString('pt-BR')}</strong></span>
                  <span><small>FREEZES</small><strong>{freezeCount} · {freezeDuration.toFixed(2)} s</strong></span>
                  <span><small>DECODE MÉDIO</small><strong>{decodeTimeMs !== null ? `${decodeTimeMs} ms/frame` : '—'}</strong></span>
                  <span><small>PACOTES</small><strong>{packetsReceived.toLocaleString('pt-BR')} recebidos</strong></span>
                  <span><small>PERDIDOS</small><strong>{packetsLost.toLocaleString('pt-BR')} · {packetLossPercent ?? '—'}%</strong></span>
                  <span><small>NACK / RTX</small><strong>{nackCount} / {retransmittedPackets}</strong></span>
                  <span><small>PLI</small><strong>{pliCount}</strong></span>
                  <span><small>JITTER / RTT</small><strong>{jitterMs ?? '—'} ms / {roundTripMs ?? '—'} ms</strong></span>
                  <span><small>DISPLAY ESTIMADO</small><strong>{displayRefreshHz ?? '—'} Hz</strong></span>
                </div>
                <p>O refresh é estimado com animação do navegador. Receber ou decodificar 120 FPS não garante exibição visual de 120 FPS em uma tela de 60 Hz.</p>
              </section>}
              {connected && diagnosticWarning && <p className="stream-health-warning">△ {diagnosticWarning}</p>}
            </div>
            {phase !== 'joining' && <aside className="chat-panel">
              <header className="chat-header"><div><span className="chat-kicker">SALA DE CONVERSA</span><h2>Chat do cinema</h2></div><span className={`voice-pill ${micEnabled ? 'active' : ''}`}><i /> {micEnabled ? 'VOCÊ ESTÁ FALANDO' : connected ? 'VOZ DISPONÍVEL' : 'CONECTANDO'}</span></header>
              <div className="chat-messages" aria-live="polite">
                {chatMessages.length === 0 && <div className="empty-chat"><span>✦</span><p>O chat está pronto.<br/>Seja a primeira pessoa a falar.</p></div>}
                {chatMessages.map((chatMessage) => chatMessage.kind === 'system' ? <div className="system-message" key={chatMessage.id}><span>✦</span>{chatMessage.text}</div> : <article className="chat-message" key={chatMessage.id}><Avatar profile={chatMessage.profile ?? hostProfile} /><div><header><strong>{chatMessage.profile?.name ?? 'Convidado'}</strong><time>{new Date(chatMessage.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time></header><p>{chatMessage.text}</p></div></article>)}
                <div ref={chatEndRef} />
              </div>
              <form className="chat-composer" onSubmit={sendChat}>
                <div className="composer-profile"><Avatar profile={displayProfile} /><span className={micEnabled ? 'speaking' : ''} /></div>
                <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} maxLength={500} rows={1} placeholder="Escreva uma mensagem…" aria-label="Mensagem para o chat" disabled={!connected} />
                <button type="submit" aria-label="Enviar mensagem" disabled={!connected || !chatInput.trim()}>↑</button>
              </form>
              <footer className="chat-footer">ENTER PARA ENVIAR · SHIFT + ENTER PARA QUEBRAR LINHA</footer>
            </aside>}
          </div>
        </section>
        {isHost ? <section className="host-dock"><div><span className="dock-label">INGRESSO DA SESSÃO</span><p>{shareUrl}</p><small className="performance-notice">Abra o CineLéo Studio e escolha 1080p60 Estável, 1080p120 Ultra ou 2K60. Esta cabine mede a mesma imagem recebida pelos convidados.</small></div><button className="copy-button" onClick={copyLink}>{copied ? '✓ LINK COPIADO' : '▣ COPIAR LINK'}</button><button className="stop-button" onClick={leaveRoom}>■ SAIR DA CABINE</button></section> : phase !== 'joining' && <footer className="viewer-footer"><span>SESSÃO CINELÉO</span><span>Vídeo pelo LiveKit · chat e voz em tempo real · sem cadastro</span></footer>}
      </main>
    );
  }

  return (
    <main className="cinema-shell">
      <header className="topbar"><a className="brand" href="#"><span className="brand-mark">CL</span><span>CINELÉO</span></a><div className="room-status"><span /> SALA PRIVADA</div></header>
      <section className="hero"><div className="intro"><p className="eyebrow">SESSÃO PARTICULAR · SEM CADASTRO</p><h1>Sua tela.<br/><em>Em cartaz.</em></h1><p className="lede">Transmissão Full HD ou 2K com perfis de até 120 FPS pelo CineLéo Studio, codificada pela sua RTX e distribuída por um servidor WebRTC profissional. Seus convidados entram pelo link, sem criar conta.</p></div>
        <div className="projector-card"><div className="card-head"><div><span className="overline">CINELÉO STUDIO</span><h2>Prepare a projeção</h2></div><span className="ticket">60+</span></div>
          <div className="field-group"><label>PADRÃO DA TRANSMISSÃO</label><div className="quality-options"><button className="selected" type="button"><strong>Full HD</strong><small>1920 × 1080 · definição fixa</small></button><button className="selected" type="button"><strong>RTX NVENC</strong><small>codificação dedicada na GPU</small></button></div></div>
          <div className="field-group fps-group"><label>PERFIS OTIMIZADOS</label><div className="fps-options studio-specs"><button type="button"><strong>60</strong><small>FPS · ESTÁVEL</small></button><button type="button"><strong>120</strong><small>FPS · ULTRA</small></button><button type="button"><strong>2K</strong><small>60 FPS</small></button></div><p className="fps-note">O Studio reduz picos de bitrate, usa captura e codificação na GPU e envia uma única cópia ao LiveKit. O painel separa FPS recebido de FPS realmente exibido.</p></div>
          <button className="primary-button" onClick={startHosting}><span className="play">▶</span> ABRIR CABINE</button><p className="privacy-note"><span>◇</span> Depois, escolha o perfil no aplicativo CineLéo Studio</p>
        </div>
      </section>
      <section className="marquee" aria-label="Características"><span>SEM LOGIN</span><i>✦</i><span>CHAT AO VIVO</span><i>✦</i><span>VOZ WEBRTC</span><i>✦</i><span>FULL HD / 2K</span><i>✦</i><span>ATÉ 120 FPS</span><i>✦</i><span>RTX NVENC</span></section>
      <section className="features"><div className="feature-index">01—03</div><article><span>01</span><h3>Abra a cabine</h3><p>O site conecta você à sala e deixa o chat, a voz e o link prontos.</p></article><article><span>02</span><h3>Ligue o Studio</h3><p>Comece em 1080p60 Estável; use 120 FPS quando o aparelho do convidado também suportar.</p></article><article><span>03</span><h3>Confira o diagnóstico</h3><p>FPS recebido, FPS exibido, bitrate, perda e rota mostram exatamente onde está o gargalo.</p></article></section>
    </main>
  );
}
