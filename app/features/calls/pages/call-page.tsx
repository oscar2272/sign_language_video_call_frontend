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
const AI_WS_URL = `${WS_BASE_URL}/ai`; // AI WebSocket URL

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const navigate = useNavigate();
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

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

  // AI 기능 관련 상태들
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<
    "disabled" | "connecting" | "connected" | "error"
  >("disabled");
  const [subtitle, setSubtitle] = useState<string>("");
  const [handLandmarks, setHandLandmarks] = useState<any[]>([]);

  // 기존 refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // AI 관련 refs
  const aiWsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameCountRef = useRef(0);

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

      // MediaPipe CDN에서 로드
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
      document.head.appendChild(script);

      await new Promise((resolve) => {
        script.onload = resolve;
      });

      // @ts-ignore - MediaPipe global 변수
      const { Hands } = window;

      const hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2, // 최대 2개의 손 감지
        modelComplexity: 0, // CPU 최적화를 위해 0으로 설정
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults((results) => {
        if (
          results.multiHandLandmarks &&
          results.multiHandLandmarks.length > 0
        ) {
          const landmarks = results.multiHandLandmarks.map((hand) =>
            hand.map((point) => ({
              x: point.x,
              y: point.y,
            }))
          );

          setHandLandmarks(landmarks);

          // 좌표값 콘솔에 출력 (디버깅용)
          console.log("Hand landmarks detected:", {
            handCount: landmarks.length,
            landmarks: landmarks,
          });
        } else {
          setHandLandmarks([]);
        }
      });

      handsRef.current = hands;
      addDebugLog("MediaPipe initialized successfully");
      return true;
    } catch (error) {
      addDebugLog(`MediaPipe initialization error: ${error}`);
      return false;
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    if (!roomId) return;

    addDebugLog("Connecting to AI WebSocket...");
    setAiStatus("connecting");

    const aiWs = new WebSocket(`${AI_WS_URL}?role=client&room=${roomId}`);

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
      setAiStatus("connected");
    };

    aiWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        addDebugLog(`AI WebSocket message: ${data.type}`);

        if (data.type === "ai_result") {
          setSubtitle(data.text || "");
          addDebugLog(`Received subtitle: ${data.text}`);
        }
      } catch (error) {
        addDebugLog(`AI WebSocket message parsing error: ${error}`);
      }
    };

    aiWs.onclose = () => {
      addDebugLog("AI WebSocket disconnected");
      setAiStatus("disabled");
    };

    aiWs.onerror = (error) => {
      addDebugLog(`AI WebSocket error: ${error}`);
      setAiStatus("error");
    };

    aiWsRef.current = aiWs;
  };

  // 손 좌표 전송 (15fps)
  const startHandTracking = () => {
    if (!handsRef.current || !canvasRef.current || !localVideoRef.current)
      return;

    addDebugLog("Starting hand tracking at 15fps");

    frameIntervalRef.current = setInterval(async () => {
      const video = localVideoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.videoWidth === 0) return;

      // 비디오를 캔버스에 그리기
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

      // MediaPipe로 손 인식 실행
      await handsRef.current.send({ image: canvas });

      frameCountRef.current++;
    }, 1000 / 15); // 15fps = 66.67ms 간격
  };

  // 손 좌표 데이터 전송
  useEffect(() => {
    if (
      isAIEnabled &&
      handLandmarks.length > 0 &&
      aiWsRef.current?.readyState === WebSocket.OPEN
    ) {
      const data = {
        type: "hand_landmarks",
        room_id: roomId,
        landmarks: handLandmarks,
        timestamp: Date.now(),
      };

      aiWsRef.current.send(JSON.stringify(data));

      // 디버깅: 전송된 데이터 로그
      console.log("Sent hand landmarks:", {
        handCount: handLandmarks.length,
        timestamp: data.timestamp,
        firstHandFirstPoint: handLandmarks[0]?.[0], // 첫 번째 손의 첫 번째 점만 출력
      });
    }
  }, [handLandmarks, isAIEnabled, roomId]);

  // AI 기능 토글
  const toggleAI = () => {
    if (!isAIEnabled) {
      // AI 기능 켜기
      connectAIWebSocket();
      startHandTracking();
      setIsAIEnabled(true);
      addDebugLog("AI feature enabled");

      // 다른 사용자에게 AI 활성화 알림
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ai_toggle",
            enabled: true,
            user_id: user.id,
          })
        );
      }
    } else {
      // AI 기능 끄기
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
      }
      if (aiWsRef.current) {
        aiWsRef.current.close();
      }
      setIsAIEnabled(false);
      setAiStatus("disabled");
      setSubtitle("");
      setHandLandmarks([]);
      addDebugLog("AI feature disabled");

      // 다른 사용자에게 AI 비활성화 알림
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ai_toggle",
            enabled: false,
            user_id: user.id,
          })
        );
      }
    }
  };

  // 기존 WebRTC 설정
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

  // 기존 미디어 스트림 초기화 (MediaPipe 초기화 추가)
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

      // MediaPipe 초기화
      await initializeMediaPipe();

      return stream;
    } catch (error) {
      addDebugLog(`Media access error: ${error}`);
      alert("카메라와 마이크 접근 권한이 필요합니다.");
      return null;
    }
  };

  // 기존 WebSocket 연결 (AI 토글 메시지 처리 추가)
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
          addDebugLog(`AI toggle by user ${data.user_id}: ${data.enabled}`);
          // 다른 사용자가 AI를 활성화했다면 현재 사용자는 비활성화
          if (data.enabled && data.user_id !== user.id && isAIEnabled) {
            toggleAI(); // 현재 사용자의 AI 비활성화
            alert(
              "상대방이 AI 기능을 활성화했습니다. 현재 사용자의 AI 기능이 비활성화됩니다."
            );
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

  // 나머지 기존 함수들... (createOffer, handleOffer, handleAnswer, handleIceCandidate 등)
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

  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000);
  };

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

  const cleanup = () => {
    addDebugLog("Cleaning up resources...");

    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
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
  };

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

      addDebugLog("Media stream ready, connecting WebSocket");
      wsRef.current = connectWebSocket(stream);
    };

    init();

    return cleanup;
  }, [roomId]);

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
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <div>
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
              <span className="text-sm sm:text-base">
                통화가 거절되었습니다
              </span>
            )}
            {callStatus === "ended" && (
              <span className="text-sm sm:text-base">
                통화가 종료되었습니다
              </span>
            )}
          </div>

          {/* AI 상태 표시 */}
          {isAIEnabled && (
            <div className="text-xs flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  aiStatus === "connected"
                    ? "bg-green-400"
                    : aiStatus === "connecting"
                      ? "bg-yellow-400"
                      : "bg-red-400"
                }`}
              ></span>
              AI: {aiStatus} | 손: {handLandmarks.length}개 | 프레임:{" "}
              {frameCountRef.current}
            </div>
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
        style={{ maxHeight: "calc(100vh - 220px)" }}
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
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 자막 영역 */}
        {subtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-lg max-w-md text-center">
            <span className="text-lg font-medium">{subtitle}</span>
          </div>
        )}

        {/* MediaPipe용 숨겨진 캔버스 */}
        <canvas ref={canvasRef} className="hidden" />

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
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[100px] flex flex-col items-center justify-center gap-3">
        {/* 첫 번째 줄: 기본 컨트롤 */}
        <div className="flex justify-center gap-2 sm:gap-4 w-full max-w-lg">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="flex-1 max-w-[120px] px-2 py-2 text-xs sm:text-sm sm:px-4"
          >
            <span className="hidden sm:inline">
              {isMicOn ? "마이크 켜짐" : "마이크 꺼짐"}
            </span>
            <span className="sm:hidden">{isMicOn ? "🎤" : "🔇"}</span>
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="flex-1 max-w-[120px] px-2 py-2 text-xs sm:text-sm sm:px-4"
          >
            <span className="hidden sm:inline">
              {isCameraOn ? "카메라 켜짐" : "카메라 꺼짐"}
            </span>
            <span className="sm:hidden">{isCameraOn ? "📹" : "📷"}</span>
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="flex-1 max-w-[120px] px-2 py-2 text-xs sm:text-sm sm:px-4 bg-red-600 hover:bg-red-700"
          >
            <span className="hidden sm:inline">통화 종료</span>
            <span className="sm:hidden">📞</span>
          </Button>
        </div>

        {/* 두 번째 줄: AI 토글 버튼 */}
        <div className="flex justify-center">
          <Button
            onClick={toggleAI}
            variant={isAIEnabled ? "default" : "outline"}
            className={`px-4 py-2 text-sm ${
              isAIEnabled
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "border-blue-500 text-blue-500 hover:bg-blue-50"
            }`}
          >
            <span className="flex items-center gap-2">
              🤖 수어번역 {isAIEnabled ? "켜짐" : "꺼짐"}
              {isAIEnabled && aiStatus === "connecting" && (
                <span className="animate-spin">⏳</span>
              )}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
