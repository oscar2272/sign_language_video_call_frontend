import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

// MediaPipe 타입 정의
declare global {
  interface Window {
    Hands: any;
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

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "connecting" | "connected" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [connectionTime, setConnectionTime] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  // AI 기능 관련 state
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiSubtitle, setAiSubtitle] = useState<string>("");
  const [isAIBlocked, setIsAIBlocked] = useState(false); // 상대방이 AI를 켰을 때
  const [mediaPipeReady, setMediaPipeReady] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null); // AI WebSocket
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // MediaPipe 관련 refs
  const handsRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aiIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameIdRef = useRef<number>(0);

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

      // MediaPipe 스크립트 로드 확인
      if (!window.Hands) {
        addDebugLog("Loading MediaPipe scripts...");
        await loadMediaPipeScripts();
      }

      const hands = new window.Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onHandsResults);
      handsRef.current = hands;
      setMediaPipeReady(true);
      addDebugLog("MediaPipe initialized successfully");
    } catch (error) {
      addDebugLog(`MediaPipe initialization error: ${error}`);
    }
  };

  // MediaPipe 스크립트 로드
  const loadMediaPipeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.Hands) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
      script.onload = () => {
        const cameraScript = document.createElement("script");
        cameraScript.src =
          "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
        cameraScript.onload = () => resolve();
        cameraScript.onerror = () =>
          reject(new Error("Failed to load camera utils"));
        document.head.appendChild(cameraScript);
      };
      script.onerror = () => reject(new Error("Failed to load MediaPipe"));
      document.head.appendChild(script);
    });
  };

  // 손 좌표 처리 결과
  const onHandsResults = (results: any) => {
    if (
      !isAIEnabled ||
      !aiWsRef.current ||
      aiWsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks: HandLandmark[][] = results.multiHandLandmarks.map(
        (handLandmarks: any[]) =>
          handLandmarks.map((landmark: any) => ({
            x: landmark.x,
            y: landmark.y,
          }))
      );

      const data = {
        type: "hand_landmarks",
        room_id: roomId,
        landmarks: landmarks,
        timestamp: Date.now(),
      };

      console.log(`[AI] Sending hand landmarks:`, data);
      aiWsRef.current.send(JSON.stringify(data));
      frameIdRef.current++;
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    if (aiWsRef.current) {
      aiWsRef.current.close();
    }

    addDebugLog("Connecting to AI WebSocket...");
    const aiWs = new WebSocket(`${WS_BASE_URL}/ai?role=client&room=${roomId}`);

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
    };

    aiWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[AI] Received message:`, data);

        switch (data.type) {
          case "ai_result":
            const aiResult = data as AIResult;
            setAiSubtitle(aiResult.text);
            addDebugLog(
              `AI result: ${aiResult.text} (score: ${aiResult.score})`
            );

            // 3초 후 자막 사라지게 하기
            setTimeout(() => {
              setAiSubtitle("");
            }, 3000);
            break;

          case "ai_status":
            // 상대방의 AI 상태 변경
            if (data.user_id !== user.id) {
              setIsAIBlocked(data.enabled);
              addDebugLog(
                `Remote user AI status: ${data.enabled ? "enabled" : "disabled"}`
              );
            }
            break;
        }
      } catch (error) {
        addDebugLog(`AI WebSocket message parsing error: ${error}`);
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

  // AI 기능 토글
  const toggleAI = () => {
    if (isAIBlocked) {
      alert("상대방이 이미 AI 기능을 사용 중입니다.");
      return;
    }

    const newAIEnabled = !isAIEnabled;
    setIsAIEnabled(newAIEnabled);

    // AI 상태를 상대방에게 알리기
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "ai_status",
          user_id: user.id,
          enabled: newAIEnabled,
        })
      );
    }

    if (newAIEnabled) {
      startAIProcessing();
      addDebugLog("AI 기능 활성화");
    } else {
      stopAIProcessing();
      setAiSubtitle("");
      addDebugLog("AI 기능 비활성화");
    }
  };

  // AI 처리 시작 (15fps)
  const startAIProcessing = () => {
    if (!mediaPipeReady || !localVideoRef.current || !canvasRef.current) {
      addDebugLog("MediaPipe or video not ready for AI processing");
      return;
    }

    // 15fps = 1000/15 ≈ 67ms 간격
    aiIntervalRef.current = setInterval(() => {
      if (handsRef.current && localVideoRef.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const video = localVideoRef.current;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          handsRef.current.send({ image: canvas });
        }
      }
    }, 1000 / 15);
  };

  // AI 처리 중지
  const stopAIProcessing = () => {
    if (aiIntervalRef.current) {
      clearInterval(aiIntervalRef.current);
      aiIntervalRef.current = null;
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

  // 수정된 미디어 스트림 초기화
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

  // WebSocket 연결 수정 - AI 상태 메시지 처리 추가
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

        case "ai_status":
          // 상대방의 AI 상태 변경
          if (data.user_id !== user.id) {
            setIsAIBlocked(data.enabled);
            addDebugLog(
              `Remote user AI status: ${data.enabled ? "enabled" : "disabled"}`
            );
            if (data.enabled && isAIEnabled) {
              // 내가 AI를 켰는데 상대방도 켰다면 내 AI 끄기
              setIsAIEnabled(false);
              stopAIProcessing();
              alert(
                "상대방이 AI 기능을 활성화했습니다. 내 AI 기능이 비활성화됩니다."
              );
            }
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

  // 나머지 WebRTC 관련 함수들은 동일...
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

    if (aiIntervalRef.current) {
      clearInterval(aiIntervalRef.current);
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
      // 1. MediaPipe 초기화
      await initializeMediaPipe();

      // 2. 미디어 스트림 가져오기
      const stream = await initializeMedia();
      if (!stream) return;

      addDebugLog("Media stream ready, connecting WebSockets");

      // 3. WebSocket 연결들
      wsRef.current = connectWebSocket(stream);
      connectAIWebSocket();
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
      {/* 숨겨진 캔버스 - MediaPipe 처리용 */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

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
            {isAIEnabled && (
              <span className="text-xs bg-blue-600 px-2 py-1 rounded">
                AI 활성화
              </span>
            )}
            {isAIBlocked && (
              <span className="text-xs bg-red-600 px-2 py-1 rounded">
                상대방 AI 사용중
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
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* AI 자막 표시 */}
        {aiSubtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white px-4 py-2 rounded-lg max-w-xs sm:max-w-md text-center">
            <span className="text-sm sm:text-base">{aiSubtitle}</span>
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

      {/* 컨트롤 버튼 - AI 버튼 추가 */}
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[120px] flex flex-col items-center justify-center gap-2">
        <div className="flex justify-center gap-2 sm:gap-4 w-full max-w-lg">
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

        {/* AI 기능 버튼 */}
        <div className="flex justify-center w-full max-w-lg">
          <Button
            onClick={toggleAI}
            disabled={isAIBlocked || !mediaPipeReady}
            variant={isAIEnabled ? "default" : "outline"}
            className="px-4 py-2 text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-2">
              🤖
              <span className="hidden sm:inline">
                {isAIEnabled ? "AI 끄기" : "AI 켜기"}
                {isAIBlocked ? " (상대방 사용중)" : ""}
                {!mediaPipeReady ? " (로딩중...)" : ""}
              </span>
              <span className="sm:hidden">{isAIEnabled ? "OFF" : "ON"}</span>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
