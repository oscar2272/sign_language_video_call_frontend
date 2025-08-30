import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";
// log 수정
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

// AI WebSocket URL
const AI_WS_URL = `${WS_BASE_URL}/ai`;

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

interface Subtitle {
  id: number;
  text: string;
  timestamp: number;
  score: number;
}

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

  // AI 관련 상태들
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [isAILoading, setIsAILoading] = useState(false);
  const [canToggleAI, setCanToggleAI] = useState(true); // 다른 사용자가 AI를 켰는지 여부
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>("");

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const aiWsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);

  // MediaPipe 관련 Refs
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCountRef = useRef(0);
  const lastSentTimeRef = useRef(0);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-4),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 초기화
  const initializeMediaPipe = useCallback(() => {
    if (typeof window === "undefined" || !window.Hands) {
      addDebugLog("MediaPipe not loaded");
      return;
    }

    addDebugLog("Initializing MediaPipe Hands");

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

    hands.onResults(onHandsResults);
    handsRef.current = hands;

    if (localVideoRef.current) {
      const camera = new window.Camera(localVideoRef.current, {
        onFrame: async () => {
          if (handsRef.current && isAIEnabled) {
            await handsRef.current.send({ image: localVideoRef.current });
          }
        },
        width: 1280,
        height: 720,
      });
      cameraRef.current = camera;
    }

    addDebugLog("MediaPipe Hands initialized");
  }, [isAIEnabled]);

  // 손 좌표 결과 처리
  const onHandsResults = useCallback(
    (results: any) => {
      if (
        !isAIEnabled ||
        !aiWsRef.current ||
        aiWsRef.current.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      frameCountRef.current++;
      const now = Date.now();

      // 15fps로 제한 (66.67ms마다 전송)
      if (now - lastSentTimeRef.current < 67) {
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
          timestamp: now,
        };

        aiWsRef.current.send(JSON.stringify(data));
        lastSentTimeRef.current = now;

        addDebugLog(
          `Sent landmarks: ${landmarks.length} hands, ${landmarks[0]?.length || 0} points each`
        );
      }
    },
    [isAIEnabled, roomId]
  );

  // AI WebSocket 연결
  const connectAIWebSocket = useCallback(() => {
    if (aiWsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    addDebugLog("Connecting to AI WebSocket...");

    const aiWs = new WebSocket(
      `${AI_WS_URL}?role=client&room=${roomId}&token=${token}`
    );

    aiWs.onopen = () => {
      addDebugLog("AI WebSocket connected");
      setIsAILoading(false);
    };

    aiWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "ai_result") {
          const result: AIResult = data;
          addDebugLog(`AI Result: ${result.text} (score: ${result.score})`);

          // 자막 추가
          const newSubtitle: Subtitle = {
            id: result.frame_id,
            text: result.text,
            timestamp: result.timestamp,
            score: result.score,
          };

          setSubtitles((prev) => [...prev.slice(-4), newSubtitle]); // 최근 5개만 유지
          setCurrentSubtitle(result.text);

          // 3초 후 현재 자막 제거
          setTimeout(() => {
            setCurrentSubtitle((prev) => (prev === result.text ? "" : prev));
          }, 3000);
        } else if (data.type === "ai_status") {
          // 다른 사용자의 AI 상태 변경
          if (data.user_id !== user.id) {
            setCanToggleAI(!data.enabled);
            if (data.enabled && isAIEnabled) {
              // 다른 사용자가 AI를 켰으면 내 AI는 끔
              handleAIToggle(false);
            }
          }
        }
      } catch (error) {
        addDebugLog(`AI WebSocket message error: ${error}`);
      }
    };

    aiWs.onclose = () => {
      addDebugLog("AI WebSocket disconnected");
      setIsAILoading(false);
    };

    aiWs.onerror = (error) => {
      addDebugLog(`AI WebSocket error: ${error}`);
      setIsAILoading(false);
    };

    aiWsRef.current = aiWs;
  }, [roomId, token, user.id, isAIEnabled]);

  // AI 토글 핸들러
  const handleAIToggle = useCallback(
    (enabled?: boolean) => {
      const newState = enabled !== undefined ? enabled : !isAIEnabled;

      if (!canToggleAI && newState) {
        addDebugLog("Cannot enable AI - another user has it enabled");
        return;
      }

      setIsAIEnabled(newState);
      setIsAILoading(newState);

      if (newState) {
        // AI 켜기
        connectAIWebSocket();

        // MediaPipe 시작
        if (cameraRef.current) {
          cameraRef.current.start();
        }

        // 다른 사용자에게 AI 상태 알림
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "ai_status",
              user_id: user.id,
              enabled: true,
            })
          );
        }
      } else {
        // AI 끄기
        if (aiWsRef.current) {
          aiWsRef.current.close();
          aiWsRef.current = null;
        }

        if (cameraRef.current) {
          cameraRef.current.stop();
        }

        setSubtitles([]);
        setCurrentSubtitle("");
        setIsAILoading(false);

        // 다른 사용자에게 AI 상태 알림
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "ai_status",
              user_id: user.id,
              enabled: false,
            })
          );
        }
      }

      addDebugLog(`AI ${newState ? "enabled" : "disabled"}`);
    },
    [isAIEnabled, canToggleAI, connectAIWebSocket, user.id]
  );

  // MediaPipe 스크립트 로드
  useEffect(() => {
    const loadMediaPipe = () => {
      if (window.Hands && window.Camera) {
        initializeMediaPipe();
        return;
      }

      // MediaPipe 스크립트 로드
      const script1 = document.createElement("script");
      script1.src =
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
      script1.onload = () => {
        const script2 = document.createElement("script");
        script2.src =
          "https://cdn.jsdelivr.net/npm/@mediapipe/control_utils/control_utils.js";
        script2.onload = () => {
          const script3 = document.createElement("script");
          script3.src =
            "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js";
          script3.onload = () => {
            const script4 = document.createElement("script");
            script4.src =
              "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
            script4.onload = initializeMediaPipe;
            document.head.appendChild(script4);
          };
          document.head.appendChild(script3);
        };
        document.head.appendChild(script2);
      };
      document.head.appendChild(script1);
    };

    loadMediaPipe();
  }, [initializeMediaPipe]);

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

  // WebSocket 연결 (기존 코드에 AI 상태 처리 추가)
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
          // 다른 사용자의 AI 상태 변경 처리
          if (data.user_id !== user.id) {
            setCanToggleAI(!data.enabled);
            addDebugLog(
              `Other user AI status: ${data.enabled ? "enabled" : "disabled"}`
            );

            if (data.enabled && isAIEnabled) {
              // 다른 사용자가 AI를 켰으면 내 AI는 끔
              handleAIToggle(false);
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
              <span className="ml-2 text-green-400">🤖 AI 번역 ON</span>
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
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 자막 표시 영역 */}
        {currentSubtitle && (
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-lg text-lg font-semibold max-w-xs sm:max-w-md text-center">
            {currentSubtitle}
          </div>
        )}

        {/* 자막 히스토리 */}
        {subtitles.length > 0 && !currentSubtitle && (
          <div className="absolute bottom-4 left-4 bg-black bg-opacity-50 text-white p-2 rounded text-sm max-w-xs max-h-32 overflow-y-auto">
            <div className="text-xs text-gray-300 mb-1">최근 자막:</div>
            {subtitles.slice(-3).map((subtitle) => (
              <div key={subtitle.id} className="mb-1">
                <span className="text-xs text-gray-400">
                  {new Date(subtitle.timestamp).toLocaleTimeString()}
                </span>
                <br />
                <span>{subtitle.text}</span>
                <span className="text-xs text-gray-400 ml-2">
                  ({Math.round(subtitle.score * 100)}%)
                </span>
              </div>
            ))}
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

        {/* MediaPipe 처리용 숨겨진 캔버스 */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 flex-shrink-0 p-3 sm:p-4 min-h-[120px] flex items-center justify-center">
        <div className="flex justify-center gap-2 sm:gap-3 w-full max-w-2xl flex-wrap">
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

          <Button
            onClick={() => handleAIToggle()}
            variant={isAIEnabled ? "default" : "outline"}
            disabled={(!canToggleAI && !isAIEnabled) || isAILoading}
            className="flex-1 max-w-[120px] px-2 py-2 text-xs sm:text-sm sm:px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600"
          >
            {isAILoading ? (
              <span className="flex items-center gap-1">
                <span className="animate-spin">⚙️</span>
                <span className="hidden sm:inline">연결중...</span>
              </span>
            ) : (
              <>
                <span className="hidden sm:inline">
                  {isAIEnabled
                    ? "AI 번역 켜짐"
                    : canToggleAI
                      ? "AI 번역 켜기"
                      : "AI 사용중"}
                </span>
                <span className="sm:hidden">
                  {isAIEnabled ? "🤖✅" : canToggleAI ? "🤖" : "🤖❌"}
                </span>
              </>
            )}
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
