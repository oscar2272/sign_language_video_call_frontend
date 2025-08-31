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
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
  const [remoteAIEnabled, setRemoteAIEnabled] = useState(false);

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
  const holisticRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-10), // 더 많은 로그 표시
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // MediaPipe 스크립트 로딩 (순차적으로)
  const loadMediaPipeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const scripts = [
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1640029074/drawing_utils.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/holistic.js",
      ];

      let loadedCount = 0;

      const loadScript = (src: string) => {
        return new Promise<void>((resolve, reject) => {
          if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
          }

          const script = document.createElement("script");
          script.src = src;
          script.onload = () => {
            addDebugLog(`Loaded: ${src.split("/").pop()}`);
            resolve();
          };
          script.onerror = () => {
            addDebugLog(`Failed to load: ${src.split("/").pop()}`);
            reject(new Error(`Failed to load ${src}`));
          };
          document.head.appendChild(script);
        });
      };

      // 순차적으로 스크립트 로드
      const loadSequentially = async () => {
        try {
          for (const src of scripts) {
            await loadScript(src);
            loadedCount++;
          }

          // 모든 스크립트 로드 완료 후 약간 대기
          setTimeout(() => {
            if (window.MediaPipe?.Holistic && window.MediaPipe?.Camera) {
              addDebugLog("All MediaPipe scripts loaded successfully");
              setMediaPipeLoaded(true);
              resolve();
            } else {
              addDebugLog("MediaPipe objects not found after loading");
              reject(new Error("MediaPipe objects not available"));
            }
          }, 500);
        } catch (error) {
          reject(error);
        }
      };

      loadSequentially();
    });
  };

  // MediaPipe Holistic 초기화
  const initializeHolistic = async () => {
    try {
      if (!window.MediaPipe?.Holistic) {
        addDebugLog("MediaPipe.Holistic not available");
        return;
      }

      addDebugLog("Initializing Holistic...");

      const holistic = new window.MediaPipe.Holistic({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/${file}`;
        },
      });

      holistic.setOptions({
        selfieMode: true,
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false, // 손만 필요하므로 세그멘테이션 끄기
        smoothSegmentation: false,
        refineFaceLandmarks: false, // 얼굴도 끄기
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });

      holistic.onResults(onHolisticResults);
      holisticRef.current = holistic;

      addDebugLog("Holistic initialized successfully");
      return holistic;
    } catch (error) {
      addDebugLog(`Holistic initialization error: ${error}`);
      return null;
    }
  };

  // 손 인식 결과 처리
  const onHolisticResults = (results: any) => {
    // 캔버스에 그리기
    drawResults(results);

    // 손 좌표 추출
    const landmarks: any[] = [];

    if (results.leftHandLandmarks) {
      const leftHand: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < results.leftHandLandmarks.length; i++) {
        leftHand.push({
          x: results.leftHandLandmarks[i].x,
          y: results.leftHandLandmarks[i].y,
        });
      }
      landmarks.push(leftHand);
    }

    if (results.rightHandLandmarks) {
      const rightHand: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < results.rightHandLandmarks.length; i++) {
        rightHand.push({
          x: results.rightHandLandmarks[i].x,
          y: results.rightHandLandmarks[i].y,
        });
      }
      landmarks.push(rightHand);
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

      try {
        aiWsRef.current.send(JSON.stringify(message));
        addDebugLog(
          `✅ Sent ${landmarks.length} hands to AI (${landmarks.reduce((sum, hand) => sum + hand.length, 0)} points)`
        );
      } catch (error) {
        addDebugLog(`❌ Failed to send landmarks: ${error}`);
      }
    }
  };

  // 캔버스에 결과 그리기
  const drawResults = (results: any) => {
    if (!canvasRef.current || !localVideoRef.current) return;

    const videoWidth = localVideoRef.current.videoWidth;
    const videoHeight = localVideoRef.current.videoHeight;

    if (videoWidth === 0 || videoHeight === 0) return;

    canvasRef.current.width = videoWidth;
    canvasRef.current.height = videoHeight;

    const canvasCtx = canvasRef.current.getContext("2d");
    if (!canvasCtx) return;

    canvasCtx.save();
    canvasCtx.clearRect(
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );

    // 비디오 이미지 그리기
    canvasCtx.globalCompositeOperation = "destination-atop";
    canvasCtx.drawImage(
      results.image,
      0,
      0,
      canvasRef.current.width,
      canvasRef.current.height
    );

    canvasCtx.globalCompositeOperation = "source-over";

    // 손 그리기
    if (window.MediaPipe?.drawConnectors && window.MediaPipe?.drawLandmarks) {
      if (results.leftHandLandmarks) {
        window.MediaPipe.drawConnectors(
          canvasCtx,
          results.leftHandLandmarks,
          window.MediaPipe.HAND_CONNECTIONS,
          { color: "#CC0000", lineWidth: 5 }
        );
        window.MediaPipe.drawLandmarks(canvasCtx, results.leftHandLandmarks, {
          color: "#00FF00",
          lineWidth: 2,
        });
      }

      if (results.rightHandLandmarks) {
        window.MediaPipe.drawConnectors(
          canvasCtx,
          results.rightHandLandmarks,
          window.MediaPipe.HAND_CONNECTIONS,
          { color: "#00CC00", lineWidth: 5 }
        );
        window.MediaPipe.drawLandmarks(canvasCtx, results.rightHandLandmarks, {
          color: "#FF0000",
          lineWidth: 2,
        });
      }
    }

    canvasCtx.restore();
  };

  // 카메라 스트림 시작
  const startCamera = async () => {
    if (!holisticRef.current || !localVideoRef.current) {
      addDebugLog("Holistic or video ref not ready");
      return;
    }

    try {
      addDebugLog("Starting MediaPipe camera...");

      if (window.MediaPipe?.Camera) {
        const camera = new window.MediaPipe.Camera(localVideoRef.current, {
          onFrame: async () => {
            if (!localVideoRef.current || !holisticRef.current) return;
            await holisticRef.current.send({ image: localVideoRef.current });
          },
          width: 640,
          height: 480,
        });

        cameraRef.current = camera;
        camera.start();
        addDebugLog("MediaPipe camera started");
      } else {
        addDebugLog("MediaPipe.Camera not available");
      }
    } catch (error) {
      addDebugLog(`Camera start error: ${error}`);
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    try {
      addDebugLog("Connecting to AI WebSocket...");
      setAiStatus("connecting");

      const aiWs = new WebSocket(`${AI_WS_URL}?role=client&room=${roomId}`);

      aiWs.onopen = () => {
        addDebugLog("🟢 AI WebSocket connected");
        setAiStatus("connected");
      };

      aiWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addDebugLog(`📤 AI response: ${data.type}`);

          if (data.type === "ai_result") {
            addDebugLog(
              `🔤 AI translation: ${data.text || data.result || "No text"}`
            );
          }

          // 상대방의 AI 상태 변경 알림 처리
          if (data.type === "ai_status_change" && data.user_id !== user.id) {
            setRemoteAIEnabled(data.ai_enabled);
            addDebugLog(
              `👥 Remote user ${data.ai_enabled ? "enabled" : "disabled"} AI`
            );
          }
        } catch (error) {
          addDebugLog(`❌ AI message parse error: ${error}`);
        }
      };

      aiWs.onclose = () => {
        addDebugLog("🔴 AI WebSocket disconnected");
        setAiStatus("disconnected");
      };

      aiWs.onerror = (error) => {
        addDebugLog(`❌ AI WebSocket error: ${error}`);
        setAiStatus("disconnected");
      };

      aiWsRef.current = aiWs;
    } catch (error) {
      addDebugLog(`❌ AI WebSocket connection error: ${error}`);
      setAiStatus("disconnected");
    }
  };

  // AI 기능 토글
  const toggleAI = async () => {
    // 상대방이 이미 AI를 켰으면 막기
    if (!isAIEnabled && remoteAIEnabled) {
      addDebugLog("❌ Cannot enable AI: Remote user already has AI enabled");
      alert("상대방이 이미 AI 기능을 사용 중입니다.");
      return;
    }

    if (isAIEnabled) {
      // AI 끄기
      setIsAIEnabled(false);
      if (aiWsRef.current?.readyState === WebSocket.OPEN) {
        // 상대방에게 AI 꺼짐 알림
        aiWsRef.current.send(
          JSON.stringify({
            type: "ai_status_change",
            user_id: user.id,
            ai_enabled: false,
          })
        );
        aiWsRef.current.close();
        aiWsRef.current = null;
      }

      if (cameraRef.current) {
        cameraRef.current.stop?.();
        cameraRef.current = null;
      }

      setAiStatus("disconnected");
      addDebugLog("🔴 AI feature disabled");
    } else {
      // AI 켜기
      if (!mediaPipeLoaded) {
        addDebugLog("⏳ Loading MediaPipe first...");
        try {
          await loadMediaPipeScripts();
          await initializeHolistic();
        } catch (error) {
          addDebugLog(`❌ MediaPipe loading failed: ${error}`);
          return;
        }
      }

      setIsAIEnabled(true);
      addDebugLog("🟢 AI feature enabled");

      // AI WebSocket 연결
      connectAIWebSocket();

      // 상대방에게 AI 켜짐 알림 (WebSocket 연결 후)
      setTimeout(() => {
        if (aiWsRef.current?.readyState === WebSocket.OPEN) {
          aiWsRef.current.send(
            JSON.stringify({
              type: "ai_status_change",
              user_id: user.id,
              ai_enabled: true,
            })
          );
        }
      }, 1000);

      // 카메라 스트림 시작
      setTimeout(() => {
        startCamera();
      }, 1500);
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

  // django WebSocket 연결 (수정됨 - AI 상태 알림 처리 추가)
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

        case "ai_status_change":
          if (data.user_id !== user.id) {
            setRemoteAIEnabled(data.ai_enabled);
            addDebugLog(
              `👥 Remote user ${data.ai_enabled ? "enabled" : "disabled"} AI`
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

    if (cameraRef.current) {
      cameraRef.current.stop?.();
      cameraRef.current = null;
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

  // MediaPipe 초기화 (컴포넌트 마운트 시)
  useEffect(() => {
    if (typeof window !== "undefined") {
      loadMediaPipeScripts().catch((error) => {
        addDebugLog(`MediaPipe loading failed: ${error}`);
      });
    }
  }, []);

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
        <div className="text-xs flex items-center">
          <span
            className={`inline-block w-2 h-2 rounded-full mr-2 ${
              aiStatus === "connected"
                ? "bg-green-500"
                : aiStatus === "connecting"
                  ? "bg-yellow-500"
                  : "bg-red-500"
            }`}
          ></span>
          <span className="mr-3">AI: {aiStatus}</span>
          {mediaPipeLoaded && <span className="mr-3 text-green-400">MP✓</span>}
          {isAIEnabled && handLandmarks.length > 0 && (
            <span className="text-green-300">👋 {handLandmarks.length}</span>
          )}
          {remoteAIEnabled && <span className="text-orange-300">원격AI</span>}
        </div>
      </div>

      {/* 디버그 정보 - 좌표값 실시간 표시 */}
      <div className="bg-red-900 text-white p-2 text-xs flex-shrink-0 max-h-40 overflow-y-auto">
        {debugInfo.map((info, index) => (
          <div
            key={index}
            className={index === debugInfo.length - 1 ? "text-yellow-300" : ""}
          >
            {info}
          </div>
        ))}

        {/* 실시간 좌표 디버그 정보 */}
        {isAIEnabled && handLandmarks.length > 0 && (
          <div className="text-green-300 mt-1 border-t border-green-700 pt-1">
            <div>🖐️ Hands detected: {handLandmarks.length}</div>
            {handLandmarks.map((hand, handIndex) => (
              <div key={handIndex} className="ml-2">
                Hand{handIndex + 1}: {hand.length} points | Wrist: (
                {hand[0]?.x?.toFixed(3)}, {hand[0]?.y?.toFixed(3)}) | Thumb: (
                {hand[4]?.x?.toFixed(3)}, {hand[4]?.y?.toFixed(3)}) | Index: (
                {hand[8]?.x?.toFixed(3)}, {hand[8]?.y?.toFixed(3)})
              </div>
            ))}
            <div className="text-xs text-gray-300">
              Total coordinates sent:{" "}
              {handLandmarks.reduce((sum, hand) => sum + hand.length, 0)} points
            </div>
          </div>
        )}
      </div>

      {/* 비디오 영역 */}
      <div
        className="flex-1 relative min-h-0"
        style={{ maxHeight: "calc(100vh - 240px)" }}
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
          className={`absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 bg-gray-800 rounded-lg object-cover border-2 transition-colors ${
            isAIEnabled ? "border-green-400" : "border-white"
          }`}
          style={{ transform: "scaleX(-1)" }}
        />

        {/* MediaPipe 손 인식 오버레이 캔버스 */}
        <canvas
          ref={canvasRef}
          className={`absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 rounded-lg pointer-events-none ${
            isAIEnabled ? "opacity-70" : "opacity-0"
          } transition-opacity`}
          style={{ transform: "scaleX(-1)" }}
        />

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

          {/* AI 기능 토글 버튼 - 상대방이 AI 켜면 비활성화 */}
          <Button
            onClick={toggleAI}
            disabled={remoteAIEnabled && !isAIEnabled}
            variant={isAIEnabled ? "default" : "outline"}
            className={`flex-1 max-w-[100px] px-2 py-2 text-xs sm:text-sm sm:px-4 ${
              isAIEnabled ? "bg-green-600 hover:bg-green-700" : ""
            } ${remoteAIEnabled && !isAIEnabled ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <span className="hidden sm:inline">
              {isAIEnabled
                ? "AI 켜짐"
                : remoteAIEnabled
                  ? "AI 사용중"
                  : "AI 끄기"}
            </span>
            <span className="sm:hidden">
              {isAIEnabled ? "🤖" : remoteAIEnabled ? "⏳" : "🔇"}
            </span>
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

// MediaPipe 스크립트 로딩 함수를 컴포넌트 외부로 분리
const loadMediaPipeScripts = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    // 이미 로드되었는지 확인
    if (window.MediaPipe?.Holistic && window.MediaPipe?.Camera) {
      resolve();
      return;
    }

    const scripts = [
      "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js",
      "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1640029074/drawing_utils.js",
      "https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/holistic.js",
    ];

    let loadedCount = 0;
    const totalCount = scripts.length;

    const loadScript = (src: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        // 이미 있는 스크립트인지 확인
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.crossOrigin = "anonymous";

        script.onload = () => {
          console.log(`✅ Loaded: ${src.split("/").pop()}`);
          resolve();
        };

        script.onerror = () => {
          console.error(`❌ Failed to load: ${src.split("/").pop()}`);
          reject(new Error(`Failed to load ${src}`));
        };

        document.head.appendChild(script);
      });
    };

    // 순차적으로 스크립트 로드
    const loadSequentially = async () => {
      try {
        for (const src of scripts) {
          await loadScript(src);
          loadedCount++;
        }

        // 모든 스크립트 로드 완료 후 MediaPipe 객체 확인
        let retries = 0;
        const maxRetries = 20;

        const checkMediaPipe = () => {
          if (
            window.MediaPipe?.Holistic &&
            window.MediaPipe?.Camera &&
            window.MediaPipe?.drawConnectors
          ) {
            console.log("🎉 All MediaPipe objects loaded successfully");
            resolve();
          } else if (retries < maxRetries) {
            retries++;
            console.log(
              `⏳ Waiting for MediaPipe objects... (${retries}/${maxRetries})`
            );
            setTimeout(checkMediaPipe, 100);
          } else {
            console.error(
              "❌ MediaPipe objects not found after loading scripts"
            );
            reject(new Error("MediaPipe objects not available after loading"));
          }
        };

        checkMediaPipe();
      } catch (error) {
        reject(error);
      }
    };

    loadSequentially();
  });
};

// Holistic 초기화 함수를 컴포넌트 외부로 분리
const initializeHolistic = async (
  onResults: (results: any) => void
): Promise<any> => {
  try {
    if (!window.MediaPipe?.Holistic) {
      throw new Error("MediaPipe.Holistic not available");
    }

    console.log("🚀 Initializing Holistic...");

    const holistic = new window.MediaPipe.Holistic({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/holistic@0.5.1635989137/${file}`;
      },
    });

    holistic.setOptions({
      selfieMode: true,
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false, // 필요없으면 끄기
      smoothSegmentation: false,
      refineFaceLandmarks: false, // 얼굴 필요없으면 끄기
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    holistic.onResults(onResults);

    console.log("✅ Holistic initialized successfully");
    return holistic;
  } catch (error) {
    console.error(`❌ Holistic initialization error: ${error}`);
    throw error;
  }
};
