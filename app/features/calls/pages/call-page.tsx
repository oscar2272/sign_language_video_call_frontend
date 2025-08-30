import React, { useEffect, useRef, useState } from "react";

const BASE_URL = "http://localhost:8000"; // 예시 URL
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL = "ws://localhost:8000";
const AI_WS_URL = `${WS_BASE_URL}/ai`;

// MediaPipe 타입 정의
interface MediaPipeHands {
  setOptions: (options: any) => void;
  onResults: (callback: (results: any) => void) => void;
  send: (data: { image: HTMLVideoElement }) => Promise<void>;
}

interface HandLandmark {
  x: number;
  y: number;
}

interface HandData {
  type: string;
  room_id: string;
  landmarks: HandLandmark[][];
  timestamp: number;
}

interface AIResult {
  type: string;
  room_id: string;
  frame_id?: number;
  text: string;
  score?: number;
  timestamp?: number;
}

declare global {
  interface Window {
    Hands: new (config: {
      locateFile: (file: string) => string;
    }) => MediaPipeHands;
  }
}

export default function CallPage() {
  // 기존 상태들
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "connecting" | "connected" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [connectionTime, setConnectionTime] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // AI 기능 관련 상태
  const [isAiEnabled, setIsAiEnabled] = useState(false);
  const [isAiConnected, setIsAiConnected] = useState(false);
  const [aiStatus, setAiStatus] = useState<
    "enabled_by_me" | "enabled_by_other" | "disabled"
  >("disabled");
  const [subtitle, setSubtitle] = useState("");
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  // refs
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // MediaPipe 관련 refs
  const handsRef = useRef<MediaPipeHands | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const roomId = "test-room-123"; // 실제로는 props에서 받아올 값
  const user = { id: "user-123" }; // 실제로는 context에서 받아올 값
  const token = "test-token"; // 실제로는 context에서 받아올 값

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 초기화
  const initializeMediaPipe = async (): Promise<MediaPipeHands | null> => {
    try {
      addDebugLog("Initializing MediaPipe Hands...");

      // MediaPipe Hands 로드 (CDN 사용)
      if (typeof window !== "undefined" && !window.Hands) {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
        document.head.appendChild(script);

        await new Promise<void>((resolve) => {
          script.onload = () => resolve();
        });
      }

      if (window.Hands) {
        const hands = new window.Hands({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          },
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 0, // CPU 모드를 위해 0으로 설정
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results: any) => {
          if (
            isAiEnabled &&
            results.multiHandLandmarks &&
            results.multiHandLandmarks.length > 0
          ) {
            sendHandLandmarks(results.multiHandLandmarks);
          }
        });

        handsRef.current = hands;
        addDebugLog("MediaPipe Hands initialized successfully");
        return hands;
      }
    } catch (error) {
      addDebugLog(`MediaPipe initialization error: ${error}`);
    }
    return null;
  };

  // 손 좌표 데이터 전송 (15fps)
  const sendHandLandmarks = (landmarks: any[][]) => {
    if (!aiWsRef.current || aiWsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // 좌표 데이터 변환
    const landmarksData = landmarks.map((handLandmarks: any[]) =>
      handLandmarks.map((landmark: any) => ({
        x: landmark.x,
        y: landmark.y,
      }))
    );

    const data: HandData = {
      type: "hand_landmarks",
      room_id: roomId,
      landmarks: landmarksData,
      timestamp: Date.now(),
    };

    try {
      aiWsRef.current.send(JSON.stringify(data));
      console.log("Hand landmarks sent:", data); // 디버그용
    } catch (error) {
      addDebugLog(`Error sending hand landmarks: ${error}`);
    }
  };

  // AI WebSocket 연결
  const connectAiWebSocket = () => {
    if (aiWsRef.current) {
      aiWsRef.current.close();
    }

    addDebugLog("Connecting to AI WebSocket...");
    const aiWs = new WebSocket(`${AI_WS_URL}?role=client&room=${roomId}`);

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
      setIsAiConnected(true);
    };

    aiWs.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        addDebugLog(`AI WebSocket message: ${data.type}`);

        switch (data.type) {
          case "ai_result":
            // 자막 표시
            const result = data as AIResult;
            setSubtitle(result.text || "");
            setSubtitleVisible(true);
            setTimeout(() => setSubtitleVisible(false), 3000); // 3초 후 자막 숨김
            addDebugLog(`Received subtitle: ${result.text}`);
            break;

          case "ai_status":
            // AI 상태 업데이트 (다른 사용자가 AI를 켰을 때)
            if (data.enabled_by !== user.id) {
              setAiStatus(data.enabled ? "enabled_by_other" : "disabled");
            }
            break;
        }
      } catch (error) {
        addDebugLog(`Error parsing AI message: ${error}`);
      }
    };

    aiWs.onclose = () => {
      addDebugLog("AI WebSocket disconnected");
      setIsAiConnected(false);
    };

    aiWs.onerror = (error: Event) => {
      addDebugLog(`AI WebSocket error: ${error}`);
    };

    aiWsRef.current = aiWs;
  };

  // AI 기능 토글
  const toggleAiFeature = () => {
    if (aiStatus === "enabled_by_other") {
      addDebugLog("Cannot toggle AI - enabled by other user");
      return;
    }

    const newEnabled = !isAiEnabled;
    setIsAiEnabled(newEnabled);
    setAiStatus(newEnabled ? "enabled_by_me" : "disabled");

    // AI 상태를 다른 사용자에게 알림
    if (aiWsRef.current && aiWsRef.current.readyState === WebSocket.OPEN) {
      aiWsRef.current.send(
        JSON.stringify({
          type: "ai_status",
          room_id: roomId,
          enabled: newEnabled,
          enabled_by: user.id,
        })
      );
    }

    if (newEnabled) {
      startHandTracking();
      addDebugLog("AI feature enabled - hand tracking started");
    } else {
      stopHandTracking();
      addDebugLog("AI feature disabled - hand tracking stopped");
    }
  };

  // 손 추적 시작 (15fps)
  const startHandTracking = async () => {
    if (!handsRef.current || !localVideoRef.current) {
      addDebugLog("MediaPipe or video not ready for hand tracking");
      return;
    }

    // 15fps = 66.67ms 간격
    frameIntervalRef.current = setInterval(async () => {
      if (localVideoRef.current && handsRef.current && isAiEnabled) {
        try {
          await handsRef.current.send({ image: localVideoRef.current });
        } catch (error) {
          addDebugLog(`Hand tracking error: ${error}`);
        }
      }
    }, 1000 / 15) as NodeJS.Timeout; // 15fps

    addDebugLog("Hand tracking started at 15fps");
  };

  // 손 추적 중지
  const stopHandTracking = () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    addDebugLog("Hand tracking stopped");
  };

  // WebRTC 설정 (기존 코드와 동일)
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
      }
    };

    return pc;
  };

  // 미디어 스트림 초기화
  const initializeMedia = async (): Promise<MediaStream | null> => {
    try {
      addDebugLog("Requesting media access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      localStreamRef.current = stream;
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
  const connectWebSocket = (stream: MediaStream): WebSocket => {
    addDebugLog("Connecting to WebSocket...");
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );

    ws.onopen = () => {
      addDebugLog("WebSocket connected");
      setCallStatus("connecting");
    };

    ws.onmessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      addDebugLog(`WebSocket message: ${data.type}`);
      // WebRTC 시그널링 로직...
    };

    return ws;
  };

  // 연결 시간 타이머
  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000) as NodeJS.Timeout;
  };

  // 시간 포맷팅
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 카메라/마이크 토글
  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  // 정리 함수
  const cleanup = () => {
    addDebugLog("Cleaning up resources...");

    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    stopHandTracking();

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track: MediaStreamTrack) => track.stop());
    }

    if (aiWsRef.current) {
      aiWsRef.current.close();
    }

    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  // 컴포넌트 초기화
  useEffect(() => {
    const init = async () => {
      // 미디어 및 AI WebSocket 초기화
      const stream = await initializeMedia();
      if (!stream) return;

      await initializeMediaPipe();
      connectAiWebSocket();
      wsRef.current = connectWebSocket(stream);
    };

    init();
    return cleanup;
  }, []);

  // 원격 비디오 스트림 설정
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col h-screen">
      {/* 상태 표시 */}
      <div className="bg-gray-800 text-white p-3 text-center flex-shrink-0 min-h-[60px] flex items-center justify-between">
        <div className="flex-1">
          {callStatus === "calling" && <span>전화 거는 중...</span>}
          {callStatus === "connecting" && <span>연결 중...</span>}
          {callStatus === "connected" && (
            <span>통화 중 - {formatTime(connectionTime)}</span>
          )}
        </div>

        {/* AI 상태 표시 */}
        <div className="text-sm">
          {isAiConnected && <span className="text-green-400">AI 연결됨</span>}
          {aiStatus === "enabled_by_me" && (
            <span className="text-blue-400 ml-2">AI 활성화</span>
          )}
          {aiStatus === "enabled_by_other" && (
            <span className="text-yellow-400 ml-2">상대방이 AI 사용 중</span>
          )}
        </div>
      </div>

      {/* 디버그 정보 */}
      <div className="bg-red-900 text-white p-2 text-xs flex-shrink-0 max-h-20 overflow-y-auto">
        {debugInfo.map((info, index) => (
          <div key={index}>{info}</div>
        ))}
      </div>

      {/* 비디오 영역 */}
      <div
        className="flex-1 relative min-h-0"
        style={{ maxHeight: "calc(100vh - 160px)" }}
      >
        {/* 원격 비디오 */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 로컬 비디오 */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-32 h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 자막 표시 */}
        {subtitleVisible && subtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-lg text-lg font-semibold max-w-md text-center">
            {subtitle}
          </div>
        )}

        {/* 연결 대기 플레이스홀더 */}
        {!remoteStream && callStatus !== "ended" && (
          <div className="absolute inset-0 flex items-center justify-center text-white text-xl">
            상대방을 기다리는 중...
          </div>
        )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 flex-shrink-0 p-4 min-h-[100px]">
        <div className="flex justify-center gap-4 mb-2">
          <button
            onClick={toggleMic}
            className={`px-4 py-2 rounded ${
              isMicOn
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-red-600 hover:bg-red-700"
            } text-white text-sm`}
          >
            {isMicOn ? "🎤 마이크 켜짐" : "🔇 마이크 꺼짐"}
          </button>

          <button
            onClick={toggleCamera}
            className={`px-4 py-2 rounded ${
              isCameraOn
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-red-600 hover:bg-red-700"
            } text-white text-sm`}
          >
            {isCameraOn ? "📹 카메라 켜짐" : "📷 카메라 꺼짐"}
          </button>

          <button
            onClick={() => {
              setCallStatus("ended");
              cleanup();
            }}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white text-sm"
          >
            📞 통화 종료
          </button>
        </div>

        {/* AI 기능 토글 */}
        <div className="flex justify-center">
          <button
            onClick={toggleAiFeature}
            disabled={aiStatus === "enabled_by_other"}
            className={`px-6 py-2 rounded text-sm font-semibold ${
              aiStatus === "enabled_by_other"
                ? "bg-gray-600 cursor-not-allowed text-gray-400"
                : isAiEnabled
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-purple-600 hover:bg-purple-700 text-white"
            }`}
          >
            {aiStatus === "enabled_by_other"
              ? "🤖 상대방이 AI 사용 중"
              : isAiEnabled
                ? "🤖 AI 번역 중지"
                : "🤖 AI 번역 시작"}
          </button>
        </div>
      </div>

      {/* 숨겨진 캔버스 (MediaPipe 처리용) */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
