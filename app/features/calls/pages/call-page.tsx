import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  console.log("roomd  Id:", params.id);
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

// MediaPipe 타입 정의
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawingUtils: any;
  }
}

interface HandLandmark {
  x: number;
  y: number;
}

interface AIResult {
  type: string;
  room_id: string;
  frame_id?: number;
  text: string;
  score?: number;
  timestamp?: number;
}

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const navigate = useNavigate();
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  // 기존 state들
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "connecting" | "connected" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [connectionTime, setConnectionTime] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // AI 기능 관련 state들
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<"off" | "initializing" | "active">(
    "off"
  );
  const [subtitle, setSubtitle] = useState<string>("");
  const [subtitleScore, setSubtitleScore] = useState<number>(0);
  const [remoteAIEnabled, setRemoteAIEnabled] = useState(false);

  // 기존 refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // AI 기능 refs
  const aiWsRef = useRef<WebSocket | null>(null);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCountRef = useRef(0);
  const aiFrameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    if (aiWsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    addDebugLog("Connecting to AI WebSocket...");
    const aiWs = new WebSocket(`${WS_BASE_URL}/ai?role=client&room=${roomId}`);

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
    };

    aiWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("AI WebSocket received:", data);

        if (data.type === "ai_result") {
          const aiResult: AIResult = data;
          setSubtitle(aiResult.text);
          setSubtitleScore(aiResult.score || 0);
          addDebugLog(`AI Result: ${aiResult.text} (score: ${aiResult.score})`);

          // 자막을 3초 후에 자동으로 제거
          setTimeout(() => {
            setSubtitle("");
            setSubtitleScore(0);
          }, 3000);
        } else if (data.type === "ai_toggle") {
          setRemoteAIEnabled(data.enabled);
          addDebugLog(`Remote AI ${data.enabled ? "enabled" : "disabled"}`);
        }
      } catch (error) {
        console.error("Error parsing AI WebSocket message:", error);
      }
    };

    aiWs.onclose = () => {
      addDebugLog("AI WebSocket disconnected");
    };

    aiWs.onerror = (error) => {
      addDebugLog(`AI WebSocket error: ${error}`);
    };

    aiWsRef.current = aiWs;
  };

  // MediaPipe 초기화
  const initializeMediaPipe = async () => {
    try {
      addDebugLog("Initializing MediaPipe...");
      setAiStatus("initializing");

      // MediaPipe 스크립트 로드 확인
      if (!window.Hands) {
        throw new Error("MediaPipe not loaded");
      }

      const hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        },
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 0, // CPU 모드
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results: any) => {
        if (
          results.multiHandLandmarks &&
          results.multiHandLandmarks.length > 0
        ) {
          // 15fps로 제한
          frameCountRef.current++;
          if (frameCountRef.current % 4 !== 0) return; // 60fps -> 15fps

          const landmarks = results.multiHandLandmarks.map(
            (handLandmarks: any) =>
              handLandmarks.map((landmark: any) => ({
                x: landmark.x,
                y: landmark.y,
              }))
          );

          const handData = {
            type: "hand_landmarks",
            room_id: roomId,
            landmarks: landmarks,
            timestamp: Date.now(),
          };

          // AI 서버로 전송
          if (aiWsRef.current?.readyState === WebSocket.OPEN) {
            aiWsRef.current.send(JSON.stringify(handData));
            console.log(
              "Hand landmarks sent:",
              landmarks.length,
              "hands detected"
            );
          }

          // 캔버스에 손 그리기 (디버그용)
          drawHands(results);
        }
      });

      handsRef.current = hands;

      // 카메라 설정
      if (localVideoRef.current) {
        const camera = new window.Camera(localVideoRef.current, {
          onFrame: async () => {
            if (handsRef.current && localVideoRef.current) {
              await handsRef.current.send({ image: localVideoRef.current });
            }
          },
          width: 640,
          height: 480,
        });

        cameraRef.current = camera;
        await camera.start();
      }

      setAiStatus("active");
      addDebugLog("MediaPipe initialized successfully");
    } catch (error) {
      addDebugLog(`MediaPipe initialization failed: ${error}`);
      setAiStatus("off");
      setIsAIEnabled(false);
    }
  };

  // 손 그리기 (디버그용)
  const drawHands = (results: any) => {
    if (!canvasRef.current || !localVideoRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = localVideoRef.current.videoWidth;
    canvas.height = localVideoRef.current.videoHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (results.multiHandLandmarks) {
      results.multiHandLandmarks.forEach((landmarks: any) => {
        // 손목 표시
        ctx.fillStyle = "red";
        ctx.beginPath();
        ctx.arc(
          landmarks[0].x * canvas.width,
          landmarks[0].y * canvas.height,
          5,
          0,
          2 * Math.PI
        );
        ctx.fill();

        // 다른 랜드마크들 표시
        ctx.fillStyle = "blue";
        landmarks.slice(1).forEach((landmark: any) => {
          ctx.beginPath();
          ctx.arc(
            landmark.x * canvas.width,
            landmark.y * canvas.height,
            3,
            0,
            2 * Math.PI
          );
          ctx.fill();
        });
      });
    }
  };

  // AI 토글 함수
  const toggleAI = async () => {
    if (remoteAIEnabled) {
      alert("상대방이 이미 AI 기능을 사용 중입니다.");
      return;
    }

    const newAIState = !isAIEnabled;
    setIsAIEnabled(newAIState);

    if (newAIState) {
      // AI 기능 켜기
      connectAIWebSocket();
      await initializeMediaPipe();
    } else {
      // AI 기능 끄기
      setAiStatus("off");
      setSubtitle("");

      if (cameraRef.current) {
        cameraRef.current.stop();
      }

      if (aiFrameIntervalRef.current) {
        clearInterval(aiFrameIntervalRef.current);
      }
    }

    // 상대방에게 AI 상태 알리기
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "ai_toggle",
          enabled: newAIState,
        })
      );
    }

    addDebugLog(`AI ${newAIState ? "enabled" : "disabled"}`);
  };

  // MediaPipe 스크립트 로드
  const loadMediaPipeScripts = () => {
    return new Promise<void>((resolve, reject) => {
      if (window.Hands) {
        resolve();
        return;
      }

      const scripts = [
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js",
      ];

      let loadedCount = 0;

      scripts.forEach((src) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          loadedCount++;
          if (loadedCount === scripts.length) {
            resolve();
          }
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    });
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

        case "ai_toggle":
          setRemoteAIEnabled(data.enabled);
          addDebugLog(`Remote AI ${data.enabled ? "enabled" : "disabled"}`);
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
  const createOffer = async (stream: MediaStream) => {
    addDebugLog("Creating offer...");

    if (!stream) {
      addDebugLog("Stream not provided to createOffer");
      return;
    }

    addDebugLog(`Stream ready with ${stream.getTracks().length} tracks`);

    const pc = createPeerConnection();
    pcRef.current = pc;

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

  // Offer 처리
  const handleOffer = async (
    offer: RTCSessionDescriptionInit,
    stream: MediaStream
  ) => {
    addDebugLog("Handling offer...");

    if (!stream) {
      addDebugLog("Stream not available for handling offer");
      return;
    }

    const pc = createPeerConnection();
    pcRef.current = pc;

    stream.getTracks().forEach((track) => {
      addDebugLog(`Adding ${track.kind} track to peer connection`);
      pc.addTrack(track, stream);
    });

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      addDebugLog("Remote description (offer) set");

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

    if (aiFrameIntervalRef.current) {
      clearInterval(aiFrameIntervalRef.current);
    }

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

    if (cameraRef.current) {
      cameraRef.current.stop();
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
      // MediaPipe 스크립트 로드
      try {
        await loadMediaPipeScripts();
        addDebugLog("MediaPipe scripts loaded");
      } catch (error) {
        addDebugLog("Failed to load MediaPipe scripts");
      }

      // 미디어 스트림 초기화
      const stream = await initializeMedia();
      if (!stream) return;

      addDebugLog("Media stream ready, connecting WebSocket");
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
      {/* 상태 표시 */}
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
            {isAIEnabled && (
              <span className="ml-2 text-green-400">AI 활성화</span>
            )}
            {remoteAIEnabled && (
              <span className="ml-2 text-blue-400">상대방 AI 활성화</span>
            )}
          </span>
        )}
        {callStatus === "rejected" && (
          <span className="text-sm sm:text-base">통화가 거절되었습니다</span>
        )}
        {callStatus === "ended" && (
          <span className="text-sm sm:text-base">통화가 종료되었습니다</span>
        )}
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
        style={{ maxHeight: "calc(100vh - 180px)" }}
      >
        {/* 원격 비디오 (큰 화면) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 로컬 비디오 (작은 화면) */}
        <div className="absolute top-2 right-2">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
            style={{ transform: "scaleX(-1)" }}
          />
          {/* 손 랜드마크 캔버스 */}
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-24 h-18 sm:w-32 sm:h-24 rounded-lg pointer-events-none"
            style={{ transform: "scaleX(-1)" }}
          />
        </div>

        {/* 자막 표시 */}
        {subtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-80 text-white px-4 py-2 rounded-lg text-center max-w-xs sm:max-w-md">
            <div className="text-lg font-semibold">{subtitle}</div>
            {subtitleScore > 0 && (
              <div className="text-xs text-gray-300">
                신뢰도: {Math.round(subtitleScore * 100)}%
              </div>
            )}
          </div>
        )}

        {/* 연결 대기 중일 때 플레이스홀더 */}
        {!remoteStream &&
          callStatus !== "ended" &&
          callStatus !== "rejected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-lg sm:text-xl">
              상대방을 기다리는 중...
            </div>
          )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[120px] flex flex-col">
        {/* 첫 번째 줄: 기본 컨트롤 */}
        <div className="flex justify-center gap-2 sm:gap-4 w-full max-w-lg mx-auto mb-2">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-4"
          >
            <span className="hidden sm:inline">
              {isMicOn ? "마이크 켜짐" : "마이크 꺼짐"}
            </span>
            <span className="sm:hidden">{isMicOn ? "🎤" : "🔇"}</span>
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-4"
          >
            <span className="hidden sm:inline">
              {isCameraOn ? "카메라 켜짐" : "카메라 꺼짐"}
            </span>
            <span className="sm:hidden">{isCameraOn ? "📹" : "📷"}</span>
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-4 bg-red-600 hover:bg-red-700"
          >
            <span className="hidden sm:inline">통화 종료</span>
            <span className="sm:hidden">📞</span>
          </Button>
        </div>

        {/* 두 번째 줄: AI 컨트롤 */}
        <div className="flex justify-center">
          <Button
            onClick={toggleAI}
            variant={isAIEnabled ? "default" : "secondary"}
            disabled={remoteAIEnabled}
            className={`px-4 py-2 text-xs sm:text-sm ${
              aiStatus === "initializing"
                ? "opacity-50 cursor-not-allowed"
                : isAIEnabled
                  ? "bg-green-600 hover:bg-green-700"
                  : remoteAIEnabled
                    ? "opacity-50 cursor-not-allowed"
                    : ""
            }`}
          >
            {aiStatus === "initializing" ? (
              <span>AI 초기화 중...</span>
            ) : isAIEnabled ? (
              <span>🤖 AI 수어번역 ON</span>
            ) : remoteAIEnabled ? (
              <span>🤖 상대방 AI 사용중</span>
            ) : (
              <span>🤖 AI 수어번역 OFF</span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
