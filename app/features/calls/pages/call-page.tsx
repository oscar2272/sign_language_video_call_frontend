import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const navigate = useNavigate();
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "connecting" | "connected" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [connectionTime, setConnectionTime] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // WebRTC 설정
  const createPeerConnection = () => {
    addDebugLog("Creating peer connection...");

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        addDebugLog("Sending ICE candidate");
        wsRef.current.send(
          JSON.stringify({
            type: "ice",
            candidate: event.candidate,
          })
        );
      } else if (!event.candidate) {
        addDebugLog("ICE gathering complete");
      }
    };

    pc.ontrack = (event) => {
      addDebugLog("Remote track received");
      setRemoteStream(event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      addDebugLog(`Connection state changed: ${state}`);

      if (state === "connected") {
        setCallStatus("connected");
        startConnectionTimer();
      } else if (state === "failed" || state === "closed") {
        addDebugLog("Connection failed or closed, ending call");
        endCall();
      }
    };

    pc.onicegatheringstatechange = () => {
      addDebugLog(`ICE gathering state: ${pc.iceGatheringState}`);
    };

    pc.onsignalingstatechange = () => {
      addDebugLog(`Signaling state: ${pc.signalingState}`);
    };

    return pc;
  };

  // 미디어 스트림 초기화
  const initializeMedia = async () => {
    try {
      addDebugLog("Requesting media access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      setLocalStream(stream);
      addDebugLog("Media access granted");

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error) {
      addDebugLog(`Media access error: ${error}`);
      alert("카메라와 마이크 접근 권한이 필요합니다.");
      return null;
    }
  };

  // WebSocket 연결
  const connectWebSocket = () => {
    addDebugLog("Connecting to WebSocket...");
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );

    ws.onopen = () => {
      addDebugLog("WebSocket connected");
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      addDebugLog(`WebSocket message: ${data.type}`);

      switch (data.type) {
        case "user_joined":
          addDebugLog("User joined, creating offer");
          setCallStatus("connecting");
          // 짧은 지연 후 offer 생성
          setTimeout(() => createOffer(), 1000);
          break;

        case "offer":
          await handleOffer(data.offer);
          break;

        case "answer":
          await handleAnswer(data.answer);
          break;

        case "ice":
          await handleIceCandidate(data.candidate);
          break;

        case "end_call":
          setCallStatus("ended");
          cleanup();
          setTimeout(() => navigate("/friends"), 2000);
          break;
      }
    };

    ws.onclose = () => {
      addDebugLog("WebSocket disconnected");
    };

    ws.onerror = (error) => {
      addDebugLog(`WebSocket error: ${error}`);
    };

    return ws;
  };

  // Offer 생성
  const createOffer = async () => {
    addDebugLog("Creating offer...");

    if (!localStream) {
      addDebugLog("Local stream not ready, waiting...");
      return;
    }

    // PeerConnection 생성 및 트랙 추가
    const pc = createPeerConnection();
    pcRef.current = pc;

    // 로컬 스트림 트랙들을 먼저 추가
    localStream.getTracks().forEach((track) => {
      addDebugLog(`Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, localStream);
    });

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.setLocalDescription(offer);
      addDebugLog("Offer created and set as local description");

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "offer",
            offer: offer,
          })
        );
        addDebugLog("Offer sent via WebSocket");
      }
    } catch (error) {
      addDebugLog(`Error creating offer: ${error}`);
    }
  };

  // Offer 처리
  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    addDebugLog("Handling offer...");

    if (!localStream) {
      addDebugLog("Local stream not ready for handling offer");
      return;
    }

    // PeerConnection 생성 및 트랙 추가
    const pc = createPeerConnection();
    pcRef.current = pc;

    localStream.getTracks().forEach((track) => {
      addDebugLog(`Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, localStream);
    });

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      addDebugLog("Remote description (offer) set");

      // 대기 중인 ICE candidates 처리
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        addDebugLog("Added pending ICE candidate");
      }
      pendingCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      addDebugLog("Answer created and set as local description");

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "answer",
            answer: answer,
          })
        );
        addDebugLog("Answer sent via WebSocket");
      }
    } catch (error) {
      addDebugLog(`Error handling offer: ${error}`);
    }
  };

  // Answer 처리
  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    addDebugLog("Handling answer...");

    if (!pcRef.current) {
      addDebugLog("PeerConnection not ready for handling answer");
      return;
    }

    try {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      addDebugLog("Remote description (answer) set successfully");

      // 대기 중인 ICE candidates 처리
      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        addDebugLog("Added pending ICE candidate");
      }
      pendingCandidatesRef.current = [];
    } catch (error) {
      addDebugLog(`Error handling answer: ${error}`);
    }
  };

  // ICE Candidate 처리
  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) {
      addDebugLog("PeerConnection not ready, storing ICE candidate");
      pendingCandidatesRef.current.push(candidate);
      return;
    }

    if (pcRef.current.remoteDescription) {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        addDebugLog("ICE candidate added successfully");
      } catch (error) {
        addDebugLog(`Error adding ICE candidate: ${error}`);
      }
    } else {
      addDebugLog("Remote description not set, storing ICE candidate");
      pendingCandidatesRef.current.push(candidate);
    }
  };

  // 연결 시간 타이머
  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000);
  };

  // 통화 종료
  const endCall = async () => {
    addDebugLog("Ending call...");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
    }

    setCallStatus("ended");
    cleanup();

    try {
      await fetch(`${CALL_API_URL}/end/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room_id: roomId }),
      });
    } catch (err) {
      addDebugLog(`Failed to end call: ${err}`);
    }

    setTimeout(() => navigate("/friends"), 2000);
  };

  // 카메라 토글
  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
        addDebugLog(`Camera ${videoTrack.enabled ? "enabled" : "disabled"}`);
      }
    }
  };

  // 마이크 토글
  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
        addDebugLog(`Mic ${audioTrack.enabled ? "enabled" : "disabled"}`);
      }
    }
  };

  // 정리 함수
  const cleanup = () => {
    addDebugLog("Cleaning up resources...");

    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    if (pcRef.current) {
      pcRef.current.close();
    }

    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // 시간 포맷팅
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 컴포넌트 초기화
  useEffect(() => {
    if (!roomId) {
      navigate("/friends");
      return;
    }

    addDebugLog("Initializing CallPage");

    const init = async () => {
      const stream = await initializeMedia();
      if (!stream) return;

      // WebSocket 연결
      wsRef.current = connectWebSocket();
    };

    init();

    return cleanup;
  }, [roomId]);

  // 원격 비디오 스트림 설정
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      addDebugLog("Remote stream set to video element");
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      {/* 상태 표시 */}
      <div className="bg-gray-800 text-white p-4 text-center">
        {callStatus === "calling" && <span>전화 거는 중...</span>}
        {callStatus === "connecting" && <span>연결 중...</span>}
        {callStatus === "connected" && (
          <span>통화 중 - {formatTime(connectionTime)}</span>
        )}
        {callStatus === "rejected" && <span>통화가 거절되었습니다</span>}
        {callStatus === "ended" && <span>통화가 종료되었습니다</span>}
      </div>

      {/* 디버그 정보 (개발 중에만 표시) */}
      <div className="bg-red-900 text-white p-2 text-xs max-h-20 overflow-y-auto">
        {debugInfo.map((info, index) => (
          <div key={index}>{info}</div>
        ))}
      </div>

      {/* 비디오 영역 */}
      <div className="flex-1 relative">
        {/* 원격 비디오 (큰 화면) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 로컬 비디오 (작은 화면) */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 연결 대기 중일 때 플레이스홀더 */}
        {!remoteStream &&
          callStatus !== "ended" &&
          callStatus !== "rejected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-xl">
              상대방을 기다리는 중...
            </div>
          )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 p-6">
        <div className="flex justify-center gap-4">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="w-14 h-14 rounded-full text-xl"
          >
            {isMicOn ? "🎤" : "🔇"}
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="w-14 h-14 rounded-full text-xl"
          >
            {isCameraOn ? "📹" : "📷"}
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="w-14 h-14 rounded-full text-xl"
          >
            📞
          </Button>
        </div>
      </div>
    </div>
  );
}
