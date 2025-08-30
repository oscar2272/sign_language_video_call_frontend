import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

// MediaPipe 타입 정의
declare global {
  interface Window {
    MediaPipe: any;
  }
}

export const loader = async ({ params }: Route.LoaderArgs) => {
  console.log("roomId:", params.id);
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;
const AI_WS_URL = `${WS_BASE_URL}/ai`;

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

  // AI 기능 상태들
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [handLandmarks, setHandLandmarks] = useState<any[]>([]);

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // MediaPipe refs
  const handsRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-8), // 더 많은 로그 표시
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 스크립트 로드를 위한 Promise 기반 함수
  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // 이미 로드된 스크립트인지 확인
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  };

  // MediaPipe 초기화
  const initializeMediaPipe = async () => {
    try {
      addDebugLog("Loading MediaPipe scripts...");

      // 순차적으로 스크립트 로드
      await loadScript(
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js"
      );
      addDebugLog("Camera utils loaded");

      await loadScript(
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js"
      );
      addDebugLog("Hands script loaded");

      // 잠시 대기 후 MediaPipe 객체 확인
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (window.MediaPipe?.Hands) {
        await initHands();
      } else {
        addDebugLog("MediaPipe.Hands still not available, retrying...");
        // 재시도
        setTimeout(async () => {
          if (window.MediaPipe?.Hands) {
            await initHands();
          } else {
            addDebugLog("MediaPipe failed to load after retry");
          }
        }, 1000);
      }
    } catch (error) {
      addDebugLog(`MediaPipe initialization error: ${error}`);
    }
  };

  // Hands 모델 초기화
  const initHands = async () => {
    try {
      addDebugLog("Initializing MediaPipe Hands...");

      if (!window.MediaPipe?.Hands) {
        addDebugLog("MediaPipe.Hands not available");
        return;
      }

      const hands = new window.MediaPipe.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`;
        },
      });

      addDebugLog("Setting Hands options...");
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onHandsResults);
      handsRef.current = hands;

      addDebugLog("MediaPipe Hands successfully initialized");
      return hands;
    } catch (error) {
      addDebugLog(`Hands initialization error: ${error}`);
      return null;
    }
  };

  // 손 인식 결과 처리
  const onHandsResults = (results: any) => {
    if (!results.multiHandLandmarks) return;

    const landmarks: any[] = [];

    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const handLandmarks = results.multiHandLandmarks[i];
      const handData: Array<{ x: number; y: number }> = [];

      for (let j = 0; j < handLandmarks.length; j++) {
        handData.push({
          x: handLandmarks[j].x,
          y: handLandmarks[j].y,
        });
      }

      landmarks.push(handData);
    }

    setHandLandmarks(landmarks);

    // AI WebSocket으로 전송
    if (
      isAIEnabled &&
      aiWsRef.current?.readyState === WebSocket.OPEN &&
      landmarks.length > 0
    ) {
      const message = {
        type: "hand_landmarks",
        room_id: roomId,
        landmarks: landmarks,
        timestamp: Date.now(),
      };

      aiWsRef.current.send(JSON.stringify(message));
      addDebugLog(
        `Sent landmarks: ${landmarks.length} hands, ${landmarks.reduce((sum, hand) => sum + hand.length, 0)} points`
      );
    }
  };

  // MediaPipe 프레임 처리 (15fps)
  const processFrame = async () => {
    if (localVideoRef.current && handsRef.current && isAIEnabled) {
      try {
        await handsRef.current.send({ image: localVideoRef.current });
      } catch (error) {
        addDebugLog(`Frame processing error: ${error}`);
      }
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    try {
      addDebugLog("Connecting to AI WebSocket...");
      setAiStatus("connecting");

      const aiWs = new WebSocket(`${AI_WS_URL}?role=client&room=${roomId}`);

      aiWs.onopen = () => {
        addDebugLog("AI WebSocket connected");
        setAiStatus("connected");

        // 15fps로 프레임 처리 시작
        frameIntervalRef.current = setInterval(processFrame, 1000 / 15);
      };

      aiWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addDebugLog(`AI response: ${data.type}`);

          if (data.type === "ai_result") {
            addDebugLog(
              `AI translation: ${data.text || data.result || "No text"}`
            );
          }
        } catch (error) {
          addDebugLog(`AI message parse error: ${error}`);
        }
      };

      aiWs.onclose = () => {
        addDebugLog("AI WebSocket disconnected");
        setAiStatus("disconnected");
        if (frameIntervalRef.current) {
          clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = null;
        }
      };

      aiWs.onerror = (error) => {
        addDebugLog(`AI WebSocket error: ${error}`);
        setAiStatus("disconnected");
      };

      aiWsRef.current = aiWs;
    } catch (error) {
      addDebugLog(`AI WebSocket connection error: ${error}`);
      setAiStatus("disconnected");
    }
  };

  // AI 기능 토글
  const toggleAI = async () => {
    if (isAIEnabled) {
      // AI 끄기
      setIsAIEnabled(false);
      if (aiWsRef.current) {
        aiWsRef.current.close();
        aiWsRef.current = null;
      }
      if (frameIntervalRef.current) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      setAiStatus("disconnected");
      addDebugLog("AI feature disabled");
    } else {
      // AI 켜기
      addDebugLog("Enabling AI feature...");
      setIsAIEnabled(true);

      // MediaPipe 초기화 상태 확인
      addDebugLog(
        `Current MediaPipe state: ${window.MediaPipe ? "loaded" : "not loaded"}`
      );
      addDebugLog(
        `Current Hands ref: ${handsRef.current ? "initialized" : "null"}`
      );

      // MediaPipe 초기화 (아직 안 됐으면)
      if (!handsRef.current) {
        addDebugLog("Initializing MediaPipe...");
        await initializeMediaPipe();

        // 초기화 완료 대기
        let retries = 0;
        while (!handsRef.current && retries < 10) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          retries++;
          addDebugLog(
            `Waiting for MediaPipe initialization... retry ${retries}`
          );
        }

        if (!handsRef.current) {
          addDebugLog("MediaPipe initialization failed after retries");
          setIsAIEnabled(false);
          return;
        }
      }

      addDebugLog("MediaPipe ready, connecting AI WebSocket...");
      // AI WebSocket 연결
      connectAIWebSocket();
    }
  };

  // WebRTC 설정 (기존 코드)
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

  // 미디어 스트림 초기화 (기존 코드)
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

  // django WebSocket 연결 (기존 코드)
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

  // Offer 생성 (기존 코드)
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

  // Offer 처리 (기존 코드)
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

  // Answer 처리 (기존 코드)
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

  // ICE Candidate 처리 (기존 코드)
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

  // 연결 시간 타이머 (기존 코드)
  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000);
  };

  // 통화 종료 (기존 코드)
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

  // 카메라 토글 (기존 코드)
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

  // 마이크 토글 (기존 코드)
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

  // 정리 함수 (수정됨)
  const cleanup = () => {
    addDebugLog("Cleaning up resources...");

    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
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

  // 시간 포맷팅 (기존 코드)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 컴포넌트 초기화 (기존 코드)
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

  // 원격 비디오 스트림 설정 (기존 코드)
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      addDebugLog("Remote stream set to video element");
    }
  }, [remoteStream]);

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col h-screen">
      {/* 상태 표시 */}
      <div className="bg-gray-800 text-white p-3 text-center flex-shrink-0 min-h-[60px] flex items-center justify-between">
        <div className="flex-1 text-center">
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

        {/* AI 상태 표시 */}
        <div className="text-xs">
          <span
            className={`inline-block w-2 h-2 rounded-full mr-2 ${
              aiStatus === "connected"
                ? "bg-green-500"
                : aiStatus === "connecting"
                  ? "bg-yellow-500"
                  : "bg-red-500"
            }`}
          ></span>
          AI: {aiStatus}
          {isAIEnabled && handLandmarks.length > 0 && (
            <span className="ml-2">👋 {handLandmarks.length}</span>
          )}
        </div>
      </div>

      {/* 디버그 정보 - 더 많은 로그 표시 */}
      <div className="bg-red-900 text-white p-2 text-xs flex-shrink-0 max-h-32 overflow-y-auto">
        {debugInfo.map((info, index) => (
          <div
            key={index}
            className={index === debugInfo.length - 1 ? "text-yellow-300" : ""}
          >
            {info}
          </div>
        ))}
        {/* 실시간 좌표 표시 */}
        {handLandmarks.length > 0 && (
          <div className="text-green-300 mt-1">
            Hand coordinates:{" "}
            {handLandmarks
              .map((hand, i) => `Hand${i + 1}[${hand.length}pts] `)
              .join("")}
            {handLandmarks[0] && (
              <span>
                Sample: ({handLandmarks[0][0]?.x?.toFixed(3)},{" "}
                {handLandmarks[0][0]?.y?.toFixed(3)})
              </span>
            )}
          </div>
        )}
      </div>

      {/* 비디오 영역 */}
      <div
        className="flex-1 relative min-h-0"
        style={{ maxHeight: "calc(100vh - 200px)" }}
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
          className={`absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 ${
            isAIEnabled ? "border-green-400" : "border-white"
          }`}
          style={{ transform: "scaleX(-1)" }}
        />

        {/* MediaPipe 처리용 숨겨진 캔버스 */}
        <canvas ref={canvasRef} className="hidden" width={640} height={480} />

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
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[100px] flex items-center justify-center">
        <div className="flex justify-center gap-2 sm:gap-4 w-full max-w-2xl">
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

          {/* AI 기능 토글 버튼 */}
          <Button
            onClick={toggleAI}
            variant={isAIEnabled ? "default" : "outline"}
            className={`flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-4 ${
              isAIEnabled ? "bg-green-600 hover:bg-green-700" : ""
            }`}
          >
            <span className="hidden sm:inline">
              {isAIEnabled ? "AI 켜짐" : "AI 끄기"}
            </span>
            <span className="sm:hidden">{isAIEnabled ? "🤖" : "🔇"}</span>
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
      </div>
    </div>
  );
}
