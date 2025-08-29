import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

// MediaPipe 타입 정의
interface HandLandmark {
  x: number;
  y: number;
}

interface HandLandmarksData {
  type: "hand_landmarks";
  room_id: string;
  landmarks: HandLandmark[][];
  timestamp: number;
}

interface AIControlMessage {
  type: "ai_control";
  enabled: boolean;
  user_id: number;
}

// MediaPipe 글로벌 타입 선언
declare global {
  interface Window {
    MediaPipeHands: any;
    MediaPipeCamera: any;
  }
}

export const loader = async ({ params }: Route.LoaderArgs) => {
  console.log("roomd  Id:", params.id);
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;
const AI_WS_URL = `${WS_BASE_URL}/ai`; // FastAPI AI WebSocket URL

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

  // AI 기능 관련 상태
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiControlledByOther, setAiControlledByOther] = useState(false);
  const [aiTranslation, setAiTranslation] = useState<string>("");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // MediaPipe 관련 refs
  const handsRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // 핵심: 실제 스트림 객체를 ref로 관리
  const localStreamRef = useRef<MediaStream | null>(null);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 초기화
  const initializeMediaPipe = async () => {
    try {
      addDebugLog("Initializing MediaPipe...");

      // MediaPipe 스크립트를 동적으로 로드
      if (!window.MediaPipeHands) {
        await loadMediaPipeScripts();
      }

      const hands = new window.MediaPipeHands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        },
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onHandsResults);
      handsRef.current = hands;

      addDebugLog("MediaPipe initialized successfully");
      return hands;
    } catch (error) {
      addDebugLog(`MediaPipe initialization error: ${error}`);
      return null;
    }
  };

  // MediaPipe 스크립트 로드 함수
  const loadMediaPipeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const script1 = document.createElement("script");
      script1.src =
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";

      const script2 = document.createElement("script");
      script2.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";

      let loadedCount = 0;
      const onLoad = () => {
        loadedCount++;
        if (loadedCount === 2) {
          // 글로벌 객체에 할당
          window.MediaPipeHands = (window as any).Hands;
          window.MediaPipeCamera = (window as any).Camera;
          resolve();
        }
      };

      script1.onload = onLoad;
      script2.onload = onLoad;

      script1.onerror = reject;
      script2.onerror = reject;

      document.head.appendChild(script1);
      document.head.appendChild(script2);
    });
  };

  // 손 좌표 감지 결과 처리
  const onHandsResults = (results: any) => {
    if (
      !isAIEnabled ||
      !aiWsRef.current ||
      aiWsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const now = Date.now();

    // 15fps 제한 (66.67ms마다 전송)
    if (now - lastFrameTimeRef.current < 66.67) {
      return;
    }

    lastFrameTimeRef.current = now;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks.map((handLandmarks: any[]) =>
        handLandmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
        }))
      );

      const data: HandLandmarksData = {
        type: "hand_landmarks",
        room_id: roomId || "",
        landmarks: landmarks,
        timestamp: now,
      };

      aiWsRef.current.send(JSON.stringify(data));
      addDebugLog(`Sent hand landmarks: ${landmarks.length} hands detected`);
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    addDebugLog("Connecting to AI WebSocket...");
    const aiWs = new WebSocket(
      `${AI_WS_URL}?room_id=${roomId}&user_id=${user.id}`
    );

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
    };

    aiWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "translation") {
        setAiTranslation(data.text);
        addDebugLog(`Received translation: ${data.text}`);
      }
    };

    aiWs.onclose = () => {
      addDebugLog("AI WebSocket disconnected");
    };

    aiWs.onerror = (error) => {
      addDebugLog(`AI WebSocket error: ${error}`);
    };

    return aiWs;
  };

  // MediaPipe 처리 시작
  const startMediaPipeProcessing = async () => {
    if (!handsRef.current || !localVideoRef.current) {
      addDebugLog("MediaPipe or video element not ready");
      return;
    }

    const processFrame = async () => {
      if (!handsRef.current || !localVideoRef.current || !isAIEnabled) {
        return;
      }

      try {
        await handsRef.current.send({ image: localVideoRef.current });
      } catch (error) {
        addDebugLog(`MediaPipe processing error: ${error}`);
      }

      if (isAIEnabled) {
        animationRef.current = requestAnimationFrame(processFrame);
      }
    };

    animationRef.current = requestAnimationFrame(processFrame);
    addDebugLog("MediaPipe processing started");
  };

  // MediaPipe 처리 중지
  const stopMediaPipeProcessing = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      addDebugLog("MediaPipe processing stopped");
    }
  };

  // AI 기능 토글
  const toggleAI = () => {
    if (aiControlledByOther) {
      addDebugLog("AI is controlled by the other user");
      return;
    }

    const newState = !isAIEnabled;
    setIsAIEnabled(newState);

    // 상대방에게 AI 상태 전송
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const aiControlMsg: AIControlMessage = {
        type: "ai_control",
        enabled: newState,
        user_id: user.id,
      };
      wsRef.current.send(JSON.stringify(aiControlMsg));
    }

    if (newState) {
      // AI 기능 활성화
      aiWsRef.current = connectAIWebSocket();
      startMediaPipeProcessing();
      addDebugLog("AI feature enabled");
    } else {
      // AI 기능 비활성화
      stopMediaPipeProcessing();
      if (aiWsRef.current) {
        aiWsRef.current.close();
        aiWsRef.current = null;
      }
      setAiTranslation("");
      addDebugLog("AI feature disabled");
    }
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

  // 🔥 수정된 미디어 스트림 초기화
  const initializeMedia = async (): Promise<MediaStream | null> => {
    try {
      addDebugLog("Requesting media access...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true,
      });

      // ref와 state 모두 업데이트
      localStreamRef.current = stream;
      setLocalStream(stream);
      addDebugLog("Media access granted");

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream; // 스트림을 직접 반환
    } catch (error) {
      addDebugLog(`Media access error: ${error}`);
      alert("카메라와 마이크 접근 권한이 필요합니다.");
      return null;
    }
  };

  // django WebSocket 연결 - 스트림을 매개변수로 받음
  const connectWebSocket = (stream: MediaStream) => {
    addDebugLog("Connecting to WebSocket...");
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );

    ws.onopen = () => {
      addDebugLog("WebSocket connected - ready for signaling");
      setCallStatus("connecting");
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      addDebugLog(`WebSocket message: ${data.type}`);

      switch (data.type) {
        case "user_joined":
          addDebugLog("User joined, creating offer");
          setCallStatus("connecting");
          // 스트림을 직접 전달
          setTimeout(() => createOffer(stream), 500);
          break;

        case "offer":
          addDebugLog("Received offer, handling...");
          await handleOffer(data.offer, stream);
          break;

        case "answer":
          addDebugLog("Received answer, handling...");
          await handleAnswer(data.answer);
          break;

        case "ice":
          addDebugLog("Received ICE candidate");
          await handleIceCandidate(data.candidate);
          break;

        case "ai_control":
          // 상대방이 AI를 제어하는 경우
          if (data.user_id !== user.id) {
            setAiControlledByOther(data.enabled);
            if (data.enabled && isAIEnabled) {
              // 내가 AI를 켜놨는데 상대방이 켜면 내 것을 끔
              setIsAIEnabled(false);
              stopMediaPipeProcessing();
              if (aiWsRef.current) {
                aiWsRef.current.close();
                aiWsRef.current = null;
              }
              setAiTranslation("");
            }
            addDebugLog(`AI control by other user: ${data.enabled}`);
          }
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

  // 수정된 Offer 생성 - 스트림을 매개변수로 받음
  const createOffer = async (stream: MediaStream) => {
    addDebugLog("Creating offer...");

    if (!stream) {
      addDebugLog("Stream not provided to createOffer");
      return;
    }

    addDebugLog(`Stream ready with ${stream.getTracks().length} tracks`);

    // PeerConnection 생성 및 트랙 추가
    const pc = createPeerConnection();
    pcRef.current = pc;

    // 스트림 트랙들을 먼저 추가
    stream.getTracks().forEach((track) => {
      addDebugLog(`Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, stream);
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
      } else {
        addDebugLog("WebSocket not ready, cannot send offer");
      }
    } catch (error) {
      addDebugLog(`Error creating offer: ${error}`);
    }
  };

  // 수정된 Offer 처리 - 스트림을 매개변수로 받음
  const handleOffer = async (
    offer: RTCSessionDescriptionInit,
    stream: MediaStream
  ) => {
    addDebugLog("Handling offer...");

    if (!stream) {
      addDebugLog("Stream not available for handling offer");
      return;
    }

    // PeerConnection 생성 및 트랙 추가
    const pc = createPeerConnection();
    pcRef.current = pc;

    stream.getTracks().forEach((track) => {
      addDebugLog(`Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, stream);
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
    const stream = localStreamRef.current;
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
        addDebugLog(`Camera ${videoTrack.enabled ? "enabled" : "disabled"}`);
      }
    }
  };

  // 마이크 토글
  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
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

    stopMediaPipeProcessing();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    if (pcRef.current) {
      pcRef.current.close();
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    if (aiWsRef.current) {
      aiWsRef.current.close();
    }
  };

  // 시간 포맷팅
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 수정된 컴포넌트 초기화
  useEffect(() => {
    if (!roomId) {
      navigate("/friends");
      return;
    }

    addDebugLog("Initializing CallPage");

    const init = async () => {
      // 1. MediaPipe 초기화
      await initializeMediaPipe();

      // 2. 미디어 스트림을 먼저 가져오고 기다림
      const stream = await initializeMedia();
      if (!stream) return;

      addDebugLog("Media stream ready, connecting WebSocket");

      // 3. 스트림을 WebSocket 연결에 전달
      wsRef.current = connectWebSocket(stream);
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
    <div className="fixed inset-0 bg-gray-900 flex flex-col h-screen">
      {/* 상태 표시 - 고정 높이 */}
      <div className="bg-gray-800 text-white p-3 text-center flex-shrink-0 min-h-[60px] flex items-center justify-center">
        {callStatus === "calling" && (
          <span className="text-sm sm:text-base">전화 거는 중...</span>
        )}
        {callStatus === "connecting" && (
          <span className="text-sm sm:text-base">연결 중...</span>
        )}
        {callStatus === "connected" && (
          <span className="text-sm sm:text-base">
            통화 중 - {formatTime(connectionTime)}
          </span>
        )}
        {callStatus === "rejected" && (
          <span className="text-sm sm:text-base">통화가 거절되었습니다</span>
        )}
        {callStatus === "ended" && (
          <span className="text-sm sm:text-base">통화가 종료되었습니다</span>
        )}
      </div>

      {/* AI 번역 결과 표시 */}
      {aiTranslation && (
        <div className="bg-blue-900 text-white p-2 text-center flex-shrink-0">
          <span className="text-sm sm:text-base">번역: {aiTranslation}</span>
        </div>
      )}

      {/* 디버그 정보 - 고정 높이 */}
      <div className="bg-red-900 text-white p-2 text-xs flex-shrink-0 max-h-20 overflow-y-auto">
        {debugInfo.map((info, index) => (
          <div key={index}>{info}</div>
        ))}
      </div>

      {/* 비디오 영역 - 남은 공간 모두 사용하되 버튼을 위한 공간 확보 */}
      <div
        className="flex-1 relative min-h-0"
        style={{ maxHeight: "calc(100vh - 140px)" }}
      >
        {/* 원격 비디오 (큰 화면) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 로컬 비디오 (작은 화면) - 반응형 크기 */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* MediaPipe용 숨겨진 캔버스 */}
        <canvas ref={canvasRef} className="hidden" width={1280} height={720} />

        {/* 연결 대기 중일 때 플레이스홀더 */}
        {!remoteStream &&
          callStatus !== "ended" &&
          callStatus !== "rejected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-lg sm:text-xl">
              상대방을 기다리는 중...
            </div>
          )}

        {/* AI 상태 표시 */}
        {(isAIEnabled || aiControlledByOther) && (
          <div className="absolute top-2 left-2 bg-green-600 text-white px-2 py-1 rounded text-xs">
            {isAIEnabled ? "AI 수어 번역 ON" : "상대방 AI 사용 중"}
          </div>
        )}
      </div>

      {/* 컨트롤 버튼 - 고정된 높이와 항상 표시 */}
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[80px] flex items-center justify-center">
        <div className="flex justify-center gap-2 sm:gap-4 w-full max-w-2xl">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">
              {isMicOn ? "마이크 켜짐" : "마이크 꺼짐"}
            </span>
            <span className="sm:hidden">{isMicOn ? "🎤" : "🔇"}</span>
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">
              {isCameraOn ? "카메라 켜짐" : "카메라 꺼짐"}
            </span>
            <span className="sm:hidden">{isCameraOn ? "📹" : "📷"}</span>
          </Button>

          <Button
            onClick={toggleAI}
            variant={isAIEnabled ? "default" : "outline"}
            disabled={aiControlledByOther}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm"
          >
            <span className="hidden sm:inline">
              {aiControlledByOther
                ? "AI 사용중"
                : isAIEnabled
                  ? "AI ON"
                  : "AI OFF"}
            </span>
            <span className="sm:hidden">
              {aiControlledByOther ? "🤖❌" : isAIEnabled ? "🤖✅" : "🤖"}
            </span>
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm bg-red-600 hover:bg-red-700"
          >
            <span className="hidden sm:inline">통화 종료</span>
            <span className="sm:hidden">📞</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
