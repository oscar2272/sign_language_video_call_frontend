import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

// MediaPipe 타입 선언 (CDN에서 불러올 경우)
declare global {
  interface Window {
    Hands: any;
    drawingUtils: any;
    Camera: any;
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
const AI_WS_URL = `${WS_BASE_URL}/ai?role=client&room=`;

interface HandLandmark {
  x: number;
  y: number;
}

interface AIResult {
  type: "ai_result";
  room_id: string;
  frame_id: number;
  text: string;
  score: number;
  timestamp: number;
}

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

  // AI 관련 상태
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [isAIActive, setIsAIActive] = useState(false); // 다른 사람이 AI를 켰는지
  const [currentSubtitle, setCurrentSubtitle] = useState<string>("");
  const [handLandmarks, setHandLandmarks] = useState<HandLandmark[][]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const handsRef = useRef<any>(null);
  const frameIdRef = useRef<number>(0);
  const sendIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 초기화
  const initializeMediaPipe = (): any | null => {
    if (!window.Hands) {
      addDebugLog("MediaPipe Hands not loaded");
      return null;
    }

    addDebugLog("Initializing MediaPipe Hands...");

    const hands = new window.Hands({
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

    hands.onResults((results: any) => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks: HandLandmark[][] = results.multiHandLandmarks.map(
          (handLandmarks: any[]) =>
            handLandmarks.map((landmark: any) => ({
              x: landmark.x,
              y: landmark.y,
            }))
        );

        setHandLandmarks(landmarks);

        // 콘솔에 좌표 출력
        console.log("Hand landmarks detected:", landmarks);
        console.log(`Hands count: ${landmarks.length}`);
        landmarks.forEach((hand, index) => {
          console.log(`Hand ${index + 1}:`, hand.slice(0, 5)); // 처음 5개 점만 출력
        });
      } else {
        setHandLandmarks([]);
      }
    });

    return hands;
  };

  // AI WebSocket 연결
  const connectAIWebSocket = (): WebSocket | null => {
    if (!roomId) {
      addDebugLog("No room ID available for AI WebSocket");
      return null;
    }

    addDebugLog("Connecting to AI WebSocket...");
    const aiWs = new WebSocket(`${AI_WS_URL}${roomId}`);

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
    };

    aiWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "ai_result") {
          const result = data as AIResult;
          addDebugLog(`AI Result: ${result.text} (score: ${result.score})`);
          setCurrentSubtitle(result.text);

          // 자막을 3초 후에 자동으로 지움
          setTimeout(() => setCurrentSubtitle(""), 3000);
        } else if (data.type === "ai_status") {
          // 다른 사용자의 AI 상태 변경 알림
          setIsAIActive(data.active);
        }
      } catch (error) {
        addDebugLog(`AI WebSocket message error: ${error}`);
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

  // 손 좌표 전송 (15fps)
  const startSendingLandmarks = () => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
    }

    sendIntervalRef.current = setInterval(() => {
      if (
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
        frameIdRef.current += 1;

        // 디버그 로그 (너무 많이 출력되지 않도록 10프레임마다)
        if (frameIdRef.current % 10 === 0) {
          addDebugLog(`Sent landmarks (frame ${frameIdRef.current})`);
        }
      }
    }, 1000 / 15); // 15fps
  };

  const stopSendingLandmarks = () => {
    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
      sendIntervalRef.current = null;
    }
  };

  // AI 토글
  const toggleAI = () => {
    if (isAIActive && !isAIEnabled) {
      addDebugLog("AI is already active by another user");
      alert("다른 사용자가 이미 AI 기능을 사용 중입니다.");
      return;
    }

    const newAIState = !isAIEnabled;
    setIsAIEnabled(newAIState);

    if (newAIState) {
      addDebugLog("AI enabled - starting landmark detection");
      startSendingLandmarks();

      // 다른 사용자에게 AI 활성화 알림
      if (aiWsRef.current?.readyState === WebSocket.OPEN) {
        aiWsRef.current.send(
          JSON.stringify({
            type: "ai_status",
            active: true,
            user_id: user.id,
          })
        );
      }
    } else {
      addDebugLog("AI disabled - stopping landmark detection");
      stopSendingLandmarks();
      setCurrentSubtitle("");

      // 다른 사용자에게 AI 비활성화 알림
      if (aiWsRef.current?.readyState === WebSocket.OPEN) {
        aiWsRef.current.send(
          JSON.stringify({
            type: "ai_status",
            active: false,
            user_id: user.id,
          })
        );
      }
    }
  };

  // MediaPipe 프로세싱
  const processFrame = () => {
    if (handsRef.current && localVideoRef.current && isAIEnabled) {
      handsRef.current.send({ image: localVideoRef.current });
    }

    if (isAIEnabled) {
      requestAnimationFrame(processFrame);
    }
  };

  // WebRTC 설정 (기존 코드 유지)
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

  // 미디어 스트림 초기화 (기존 코드 유지)
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

  // WebSocket 연결 (기존 코드 유지)
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

  // Offer 생성 (기존 코드 유지)
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

  // Offer 처리 (기존 코드 유지)
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

  // Answer 처리 (기존 코드 유지)
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

  // ICE Candidate 처리 (기존 코드 유지)
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

  // 연결 시간 타이머 (기존 코드 유지)
  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000);
  };

  // 통화 종료 (기존 코드 유지 + AI 정리 추가)
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

  // 카메라 토글 (기존 코드 유지)
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

  // 마이크 토글 (기존 코드 유지)
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

  // 정리 함수 (기존 코드 + AI 정리 추가)
  const cleanup = () => {
    addDebugLog("Cleaning up resources...");

    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    if (sendIntervalRef.current) {
      clearInterval(sendIntervalRef.current);
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

    setIsAIEnabled(false);
    setCurrentSubtitle("");
  };

  // 시간 포맷팅 (기존 코드 유지)
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
      // MediaPipe 초기화
      handsRef.current = initializeMediaPipe();

      // AI WebSocket 연결
      aiWsRef.current = connectAIWebSocket();

      // 미디어 스트림 초기화
      const stream = await initializeMedia();
      if (!stream) return;

      addDebugLog("Media stream ready, connecting WebSocket");
      wsRef.current = connectWebSocket(stream);
    };

    init();

    return cleanup;
  }, [roomId]);

  // AI 상태가 변경될 때 MediaPipe 프로세싱 시작/중지
  useEffect(() => {
    if (isAIEnabled && handsRef.current) {
      addDebugLog("Starting MediaPipe processing");
      processFrame();
    }
  }, [isAIEnabled]);

  // 원격 비디오 스트림 설정 (기존 코드 유지)
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      addDebugLog("Remote stream set to video element");
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col h-screen">
      {/* MediaPipe 스크립트 로드 */}
      <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js"></script>

      {/* 상태 표시 */}
      <div className="bg-gray-800 text-white p-3 text-center flex-shrink-0 min-h-[60px] flex items-center justify-center">
        {callStatus === "calling" && (
          <span className="text-sm sm:text-base">전화 거는 중...</span>
        )}
        {callStatus === "connecting" && (
          <span className="text-sm sm:text-base">연결 중...</span>
        )}
        {callStatus === "connected" && (
          <div className="flex items-center gap-4">
            <span className="text-sm sm:text-base">
              통화 중 - {formatTime(connectionTime)}
            </span>
            {(isAIEnabled || isAIActive) && (
              <span className="text-xs bg-green-600 px-2 py-1 rounded">
                AI 수어 번역 활성화
              </span>
            )}
          </div>
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

        {/* 로컬 비디오 (작은 화면) */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* MediaPipe 처리용 숨겨진 캔버스 */}
        <canvas ref={canvasRef} className="hidden" width="1280" height="720" />

        {/* 자막 표시 */}
        {currentSubtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg text-lg font-semibold max-w-md text-center">
            {currentSubtitle}
          </div>
        )}

        {/* 손 좌표 디버그 표시 (개발용) */}
        {handLandmarks.length > 0 && (
          <div className="absolute top-16 left-2 bg-black bg-opacity-50 text-white p-2 text-xs rounded max-w-48">
            <div>손 감지: {handLandmarks.length}개</div>
            {handLandmarks.map((hand, index) => (
              <div key={index}>
                손 {index + 1}: ({hand[0]?.x.toFixed(2)},{" "}
                {hand[0]?.y.toFixed(2)})
              </div>
            ))}
          </div>
        )}

        {/* 연결 대기 중 플레이스홀더 */}
        {!remoteStream &&
          callStatus !== "ended" &&
          callStatus !== "rejected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-lg sm:text-xl">
              상대방을 기다리는 중...
            </div>
          )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[80px] flex items-center justify-center">
        <div className="flex justify-center gap-2 sm:gap-3 w-full max-w-2xl">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-3"
          >
            <span className="hidden sm:inline">
              {isMicOn ? "마이크 켜짐" : "마이크 꺼짐"}
            </span>
            <span className="sm:hidden">{isMicOn ? "🎤" : "🔇"}</span>
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-3"
          >
            <span className="hidden sm:inline">
              {isCameraOn ? "카메라 켜짐" : "카메라 꺼짐"}
            </span>
            <span className="sm:hidden">{isCameraOn ? "📹" : "📷"}</span>
          </Button>

          {/* AI 토글 버튼 */}
          <Button
            onClick={toggleAI}
            variant={isAIEnabled ? "default" : "outline"}
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-3"
            disabled={isAIActive && !isAIEnabled}
          >
            <span className="hidden sm:inline">
              {isAIEnabled ? "AI 켜짐" : "AI 꺼짐"}
            </span>
            <span className="sm:hidden">{isAIEnabled ? "🤖" : "🚫"}</span>
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-3 bg-red-600 hover:bg-red-700"
          >
            <span className="hidden sm:inline">통화 종료</span>
            <span className="sm:hidden">📞</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
