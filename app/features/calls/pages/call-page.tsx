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
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
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

  // AI 기능 상태들 - 중요: 초기값과 로딩 상태 분리
  const [isAIEnabled, setIsAIEnabled] = useState(false);
  const [aiStatus, setAiStatus] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [handLandmarks, setHandLandmarks] = useState<any[]>([]);
  const [mediaPipeLoaded, setMediaPipeLoaded] = useState(false);
  const [isMediaPipeInitializing, setIsMediaPipeInitializing] = useState(false);

  // 프레임 버퍼 상태들
  const [frameBuffer, setFrameBuffer] = useState<any[][]>([]);
  const frameBufferRef = useRef<any[][]>([]);
  const [bufferCount, setBufferCount] = useState(0);
  const FRAME_BUFFER_SIZE = 10; // 10프레임 모아서 전송
  const [lastFrameTime, setLastFrameTime] = useState(0); // 프레임 전송 제어
  const FRAME_SEND_INTERVAL = 100; // 100ms마다 전송 (초당 10회)

  // 자막 상태들 (기존)
  const [currentSubtitle, setCurrentSubtitle] = useState<string>("");
  const [subtitleHistory, setSubtitleHistory] = useState<
    Array<{ text: string; timestamp: number; score?: number }>
  >([]);
  const [showSubtitleHistory, setShowSubtitleHistory] = useState(false);

  // 자막 안정화 관련 새로운 상태들
  const [subtitleQueue, setSubtitleQueue] = useState<
    Array<{
      text: string;
      timestamp: number;
      confidence?: number;
    }>
  >([]);
  const [displayedSubtitle, setDisplayedSubtitle] = useState<string>("");
  const [lastSubtitleUpdate, setLastSubtitleUpdate] = useState<number>(0);

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
  const cameraRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 자막 안정화 관련 refs
  const subtitleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subtitleStabilityRef = useRef<NodeJS.Timeout | null>(null);

  // 현재 AI 활성 상태를 ref로도 관리 (콜백에서 최신 상태 참조)
  const isAIEnabledRef = useRef(false);

  // 자막 안정화 설정
  const SUBTITLE_CONFIG = {
    MIN_DISPLAY_TIME: 2000, // 최소 2초간 표시
    STABILITY_DELAY: 500, // 0.5초 안정화 지연
    MAX_DISPLAY_TIME: 5000, // 최대 5초간 표시
    MIN_CONFIDENCE: 0.6, // 최소 신뢰도 (60%)
    DUPLICATE_THRESHOLD: 0.8, // 중복 판정 임계값 (80% 유사)
  };

  // 디버그 로그 함수
  const addDebugLog = (message: string) => {
    console.log(`[CallPage] ${message}`);
    setDebugInfo((prev) => [
      ...prev.slice(-8),
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  // 클라이언트 사이드에서만 실행되는 함수들을 위한 헬퍼
  const isClient = typeof window !== "undefined";

  // 문자열 유사도 계산 함수
  const calculateSimilarity = (str1: string, str2: string): number => {
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  };

  // 레벤슈타인 거리 계산
  const levenshteinDistance = (str1: string, str2: string): number => {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  };

  // 자막 필터링 및 안정화 함수
  const processSubtitle = (newText: string, confidence: number = 1.0) => {
    const now = Date.now();

    // 신뢰도가 너무 낮으면 무시
    if (confidence < SUBTITLE_CONFIG.MIN_CONFIDENCE) {
      addDebugLog(`자막 신뢰도 낮음: ${(confidence * 100).toFixed(1)}%`);
      return;
    }

    // 현재 표시된 자막과 유사도 확인
    if (displayedSubtitle) {
      const similarity = calculateSimilarity(
        displayedSubtitle.toLowerCase(),
        newText.toLowerCase()
      );
      if (similarity > SUBTITLE_CONFIG.DUPLICATE_THRESHOLD) {
        addDebugLog(`유사한 자막 무시: ${(similarity * 100).toFixed(1)}% 유사`);
        return;
      }
    }

    // 자막 큐에 추가
    const newSubtitle = {
      text: newText,
      timestamp: now,
      confidence: confidence,
    };

    setSubtitleQueue((prev) => [...prev.slice(-4), newSubtitle]); // 최대 5개 유지

    // 기존 안정화 타이머 클리어
    if (subtitleStabilityRef.current) {
      clearTimeout(subtitleStabilityRef.current);
    }

    // 안정화 지연 후 자막 업데이트
    subtitleStabilityRef.current = setTimeout(() => {
      updateDisplayedSubtitle(newSubtitle);
    }, SUBTITLE_CONFIG.STABILITY_DELAY);

    addDebugLog(
      `자막 큐 추가: "${newText}" (신뢰도: ${(confidence * 100).toFixed(1)}%)`
    );
  };

  // 표시할 자막 업데이트
  const updateDisplayedSubtitle = (subtitle: {
    text: string;
    timestamp: number;
    confidence?: number;
  }) => {
    const now = Date.now();

    // 수어 동작 중 실시간 업데이트를 위해 최소 시간 제한 완화
    if (now - lastSubtitleUpdate < SUBTITLE_CONFIG.MIN_DISPLAY_TIME) {
      // 신뢰도가 높거나 내용이 많이 다르면 바로 업데이트 허용
      const currentConfidence = subtitle.confidence || 1.0;
      if (currentConfidence < 0.8 && displayedSubtitle) {
        addDebugLog(
          `자막 업데이트 지연: 신뢰도 낮음 ${(currentConfidence * 100).toFixed(1)}%`
        );
        return;
      }
    }

    setDisplayedSubtitle(subtitle.text);
    setCurrentSubtitle(subtitle.text);
    setLastSubtitleUpdate(now);

    // 자막 히스토리에 추가
    setSubtitleHistory((prev) => [
      ...prev,
      {
        text: subtitle.text,
        timestamp: subtitle.timestamp,
        score: subtitle.confidence,
      },
    ]);

    addDebugLog(`자막 표시: "${subtitle.text}"`);

    // 기존 타이머 클리어
    if (subtitleTimeoutRef.current) {
      clearTimeout(subtitleTimeoutRef.current);
    }

    // 자막 자동 제거 타이머 (수어 동작 중에는 더 짧게)
    subtitleTimeoutRef.current = setTimeout(() => {
      setDisplayedSubtitle("");
      setCurrentSubtitle("");
      addDebugLog(`자막 자동 제거`);
    }, SUBTITLE_CONFIG.MAX_DISPLAY_TIME);
  };

  // 수동 자막 제거 함수
  const clearCurrentSubtitle = () => {
    setDisplayedSubtitle("");
    setCurrentSubtitle("");
    setLastSubtitleUpdate(0);

    if (subtitleTimeoutRef.current) {
      clearTimeout(subtitleTimeoutRef.current);
      subtitleTimeoutRef.current = null;
    }

    if (subtitleStabilityRef.current) {
      clearTimeout(subtitleStabilityRef.current);
      subtitleStabilityRef.current = null;
    }

    addDebugLog(`자막 수동 제거`);
  };

  // 프레임 시퀀스 전송 함수
  const sendFrameSequence = (frameSequence: any[][]) => {
    if (
      !isAIEnabledRef.current ||
      !aiWsRef.current ||
      aiWsRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const message = {
      type: "hand_landmarks_sequence",
      room_id: roomId,
      frame_sequence: frameSequence, // 10프레임 x 21좌표 배열
      timestamp: Date.now(),
      test_id: Math.random().toString(36).substr(2, 9),
    };

    try {
      const messageStr = JSON.stringify(message);
      aiWsRef.current.send(messageStr);
      addDebugLog(`10프레임 시퀀스 전송 성공! [${message.test_id}]`);
    } catch (error) {
      addDebugLog(`시퀀스 전송 실패: ${error}`);
    }
  };

  // 프레임 버퍼에 추가하는 함수
  const addToFrameBuffer = (handData: Array<{ x: number; y: number }>) => {
    const now = Date.now();

    // 프레임 전송 빈도 제어 (100ms 간격)
    if (now - lastFrameTime < FRAME_SEND_INTERVAL) {
      return; // 너무 빨리 오는 프레임은 무시
    }

    setLastFrameTime(now);

    // 21개 좌표가 없으면 0으로 패딩
    const paddedHandData = [];
    for (let i = 0; i < 21; i++) {
      if (i < handData.length) {
        paddedHandData.push([handData[i].x, handData[i].y]);
      } else {
        paddedHandData.push([0, 0]); // 빈 좌표는 0으로 패딩
      }
    }

    // 새로운 프레임을 버퍼에 추가
    const newBuffer = [...frameBufferRef.current, paddedHandData];

    if (newBuffer.length >= FRAME_BUFFER_SIZE) {
      // 10프레임이 모이면 전송
      const frameSequence = newBuffer.slice(-FRAME_BUFFER_SIZE); // 최근 10프레임만 사용
      sendFrameSequence(frameSequence);

      // 버퍼 완전 초기화 (슬라이딩 윈도우 방식 제거)
      frameBufferRef.current = [];
      setFrameBuffer([]);
      setBufferCount(0);
    } else {
      // 버퍼에 추가만
      frameBufferRef.current = newBuffer;
      setFrameBuffer(newBuffer);
      setBufferCount(newBuffer.length);
    }
  };

  // MediaPipe 스크립트 로드
  const loadMediaPipeScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isClient) {
        reject(new Error("Not in client environment"));
        return;
      }

      if (window.Hands && window.Camera && window.drawConnectors) {
        addDebugLog("MediaPipe already loaded");
        setMediaPipeLoaded(true);
        resolve();
        return;
      }

      addDebugLog("Loading MediaPipe scripts...");

      const scripts = [
        "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1675466862/camera_utils.min.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.min.js",
        "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.min.js",
      ];

      let loadedCount = 0;

      scripts.forEach((src, index) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;

        script.onload = () => {
          loadedCount++;
          addDebugLog(`Script ${index + 1}/3 loaded: ${src.split("/").pop()}`);

          if (loadedCount === scripts.length) {
            // 모든 스크립트가 로드되면 잠시 기다린 후 확인
            setTimeout(() => {
              if (window.Hands && window.Camera && window.drawConnectors) {
                addDebugLog("All MediaPipe scripts loaded successfully");
                setMediaPipeLoaded(true);
                resolve();
              } else {
                addDebugLog("Scripts loaded but objects not available");
                reject(new Error("MediaPipe objects not available"));
              }
            }, 500);
          }
        };

        script.onerror = () => {
          addDebugLog(`Failed to load script: ${src}`);
          reject(new Error(`Failed to load ${src}`));
        };

        document.head.appendChild(script);
      });
    });
  };

  // Hands 모델 초기화
  const initHands = () => {
    try {
      if (!isClient || !window.Hands) {
        addDebugLog("window.Hands not available");
        return;
      }

      const hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
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

      addDebugLog("MediaPipe Hands initialized successfully");
    } catch (error) {
      addDebugLog(`Hands initialization error: ${error}`);
    }
  };

  // 손 인식 결과 처리 - 10프레임 버퍼링
  const onHandsResults = (results: any) => {
    if (!results.multiHandLandmarks) {
      setHandLandmarks([]);
      // 손이 인식되지 않아도 빈 프레임으로 처리 (연속성 유지)
      if (isAIEnabledRef.current) {
        addToFrameBuffer([]);
      }
      return;
    }

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

    // 첫 번째 손만 사용 (모델이 한 손만 처리)
    const primaryHand = landmarks.length > 0 ? landmarks[0] : [];

    if (isAIEnabledRef.current) {
      addToFrameBuffer(primaryHand);
    }
  };

  // MediaPipe 카메라 시작
  const startMediaPipeCamera = async () => {
    if (!isClient || !localVideoRef.current || !handsRef.current) {
      addDebugLog("Video element or Hands not ready");
      return;
    }

    try {
      if (window.Camera) {
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
        camera.start();
        addDebugLog("MediaPipe camera started");
      } else {
        addDebugLog("Camera utility not available");
      }
    } catch (error) {
      addDebugLog(`Camera start error: ${error}`);
    }
  };

  // MediaPipe 초기화
  const initializeMediaPipe = async () => {
    if (!isClient) return;

    try {
      setIsMediaPipeInitializing(true);
      addDebugLog("Initializing MediaPipe...");

      await loadMediaPipeScripts();
      initHands();

      // 비디오가 준비되면 카메라 시작
      if (localVideoRef.current) {
        await startMediaPipeCamera();
      }

      setIsMediaPipeInitializing(false);
    } catch (error) {
      addDebugLog(`MediaPipe initialization failed: ${error}`);
      setIsMediaPipeInitializing(false);
    }
  };

  // AI WebSocket 연결
  const connectAIWebSocket = () => {
    if (!isClient) return;

    try {
      addDebugLog("AI WebSocket 연결 시도 중...");
      setAiStatus("connecting");

      const wsUrl = `${AI_WS_URL}?role=client&room=${roomId}`;
      addDebugLog(`연결 URL: ${wsUrl}`);

      const aiWs = new WebSocket(wsUrl);

      aiWs.onopen = () => {
        addDebugLog("AI WebSocket 연결 성공!");
        setAiStatus("connected");

        // 연결 즉시 테스트 메시지 전송
        const testMessage = {
          type: "connection_test",
          room_id: roomId,
          timestamp: Date.now(),
          message: "프론트엔드 연결 테스트",
        };

        try {
          aiWs.send(JSON.stringify(testMessage));
          addDebugLog("연결 테스트 메시지 전송 완료");
        } catch (error) {
          addDebugLog(`테스트 메시지 전송 실패: ${error}`);
        }
      };

      aiWs.onmessage = (event) => {
        addDebugLog(`서버 응답 받음: ${event.data}`);
        try {
          const data = JSON.parse(event.data);

          if (data.type === "caption") {
            // 새로운 자막 처리 함수 사용
            processSubtitle(data.text, data.confidence || 1.0);
          }
        } catch (error) {
          addDebugLog(`메시지 파싱 오류: ${error}`);
        }
      };

      aiWs.onclose = (event) => {
        addDebugLog(
          `AI WebSocket 연결 종료: code=${event.code}, reason=${event.reason}`
        );
        setAiStatus("disconnected");
      };

      aiWs.onerror = (error) => {
        addDebugLog(`AI WebSocket 에러: ${error}`);
        setAiStatus("disconnected");
      };

      aiWsRef.current = aiWs;
    } catch (error) {
      addDebugLog(`WebSocket 생성 실패: ${error}`);
      setAiStatus("disconnected");
    }
  };

  // AI 기능 토글
  const toggleAI = async () => {
    if (isAIEnabled) {
      // AI 끄기
      addDebugLog("AI 기능 비활성화 중...");
      setIsAIEnabled(false);
      isAIEnabledRef.current = false; // ref도 업데이트

      // 버퍼 초기화
      frameBufferRef.current = [];
      setFrameBuffer([]);
      setBufferCount(0);

      if (aiWsRef.current) {
        aiWsRef.current.close();
        aiWsRef.current = null;
      }
      if (cameraRef.current) {
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      setAiStatus("disconnected");
      addDebugLog("AI feature disabled");
    } else {
      // AI 켜기
      addDebugLog("AI 기능 활성화 중...");
      setIsAIEnabled(true);
      isAIEnabledRef.current = true; // ref도 업데이트

      // 버퍼 초기화
      frameBufferRef.current = [];
      setFrameBuffer([]);
      setBufferCount(0);

      // MediaPipe 초기화 (아직 안 됐으면)
      if (!mediaPipeLoaded) {
        await initializeMediaPipe();
      } else if (!cameraRef.current && handsRef.current) {
        await startMediaPipeCamera();
      }

      // AI WebSocket 연결
      connectAIWebSocket();

      addDebugLog("AI feature enabled");
    }
  };

  // isAIEnabled 상태가 변경될 때마다 ref 동기화
  useEffect(() => {
    isAIEnabledRef.current = isAIEnabled;
    addDebugLog(`AI 상태 동기화: ${isAIEnabled}`);
  }, [isAIEnabled]);

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
    if (!isClient) return null;

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

        // 비디오가 로드되면 MediaPipe 준비
        localVideoRef.current.onloadedmetadata = () => {
          if (isAIEnabled && mediaPipeLoaded && handsRef.current) {
            startMediaPipeCamera();
          }
        };
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
    if (!isClient) return null;

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

    if (isClient) {
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

    if (cameraRef.current) {
      cameraRef.current.stop();
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

    // 자막 관련 타이머 클리어 추가
    if (subtitleTimeoutRef.current) {
      clearTimeout(subtitleTimeoutRef.current);
      subtitleTimeoutRef.current = null;
    }

    if (subtitleStabilityRef.current) {
      clearTimeout(subtitleStabilityRef.current);
      subtitleStabilityRef.current = null;
    }

    // AI 상태 초기화
    setIsAIEnabled(false);
    isAIEnabledRef.current = false;
    setAiStatus("disconnected");

    // 버퍼 초기화
    frameBufferRef.current = [];
    setFrameBuffer([]);
    setBufferCount(0);

    // 자막 상태 초기화
    setSubtitleQueue([]);
    setDisplayedSubtitle("");
    setCurrentSubtitle("");
    setLastSubtitleUpdate(0);
  };

  // 시간 포맷팅 (기존 코드)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 컴포넌트 초기화 - 클라이언트 사이드에서만 실행
  useEffect(() => {
    if (!isClient || !roomId) {
      if (!roomId) navigate("/friends");
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
  }, [roomId, navigate]);

  // 원격 비디오 스트림 설정
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      addDebugLog("Remote stream set to video element");
    }
  }, [remoteStream]);

  // 버튼 텍스트 결정
  const getAIButtonText = () => {
    if (isMediaPipeInitializing) return "초기화중...";
    if (!mediaPipeLoaded && !isAIEnabled) return "AI 켜기";
    if (isAIEnabled) return "AI 켜짐";
    return "AI 켜기";
  };

  const getAIButtonIcon = () => {
    if (isMediaPipeInitializing) return "⏳";
    if (!mediaPipeLoaded && !isAIEnabled) return "🔇";
    if (isAIEnabled) return "🤖";
    return "🔇";
  };

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
          {mediaPipeLoaded && <span className="text-green-400 ml-1">✓MP</span>}
          {isMediaPipeInitializing && (
            <span className="text-yellow-400 ml-1">⏳MP</span>
          )}
          {isAIEnabled && handLandmarks.length > 0 && (
            <span className="ml-2">👋 {handLandmarks.length}</span>
          )}
        </div>
      </div>

      {/* 디버그 정보 */}
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
            🤚 Hands detected: {handLandmarks.length} | Points:{" "}
            {handLandmarks.reduce((sum, hand) => sum + hand.length, 0)} |
            {handLandmarks[0] && (
              <span>
                {" "}
                Sample: ({handLandmarks[0][0]?.x?.toFixed(3)},{" "}
                {handLandmarks[0][0]?.y?.toFixed(3)})
              </span>
            )}
          </div>
        )}
        {/* 현재 상태 요약 */}
        <div className="text-blue-300 mt-1">
          🔧 State: AI={isAIEnabled ? "ON" : "OFF"} | MP=
          {mediaPipeLoaded ? "OK" : "NO"} | Init=
          {isMediaPipeInitializing ? "YES" : "NO"} | WS={aiStatus} | Buffer=
          {bufferCount}/{FRAME_BUFFER_SIZE}
        </div>
        {/* 자막 상태 표시 추가 */}
        <div className="text-purple-300 mt-1">
          📝 Subtitle: Queue={subtitleQueue.length} | Current="
          {displayedSubtitle || "none"}" | Last=
          {lastSubtitleUpdate
            ? new Date(lastSubtitleUpdate).toLocaleTimeString()
            : "never"}
        </div>
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

        {/* MediaPipe 오버레이 캔버스 */}
        {isAIEnabled && (
          <canvas
            ref={canvasRef}
            className="absolute top-2 right-2 w-24 h-18 sm:w-32 sm:h-24 pointer-events-none"
            style={{ transform: "scaleX(-1)" }}
          />
        )}

        {/* 현재 자막 표시 - displayedSubtitle 사용 */}
        {displayedSubtitle && (
          <div className="absolute bottom-20 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-80 text-white px-4 py-2 rounded-lg text-center max-w-md">
            <div className="text-lg font-bold">{displayedSubtitle}</div>
          </div>
        )}

        {/* 자막 제어 버튼들 */}
        <div className="absolute bottom-2 left-2 flex gap-2">
          {/* 자막 히스토리 버튼 */}
          {subtitleHistory.length > 0 && (
            <button
              onClick={() => setShowSubtitleHistory(!showSubtitleHistory)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm"
            >
              자막 기록 ({subtitleHistory.length})
            </button>
          )}

          {/* 현재 자막 제거 버튼 */}
          {displayedSubtitle && (
            <button
              onClick={clearCurrentSubtitle}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
              title="현재 자막 제거"
            >
              자막 제거
            </button>
          )}

          {/* 자막 큐 상태 표시 */}
          {subtitleQueue.length > 0 && (
            <div className="bg-yellow-600 text-white px-2 py-1 rounded text-xs">
              큐: {subtitleQueue.length}
            </div>
          )}
        </div>

        {/* 자막 히스토리 패널 */}
        {showSubtitleHistory && (
          <div className="absolute bottom-12 left-2 bg-black bg-opacity-90 text-white p-3 rounded-lg max-w-sm max-h-60 overflow-y-auto">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold">번역 기록</h3>
              <button
                onClick={() => setSubtitleHistory([])}
                className="text-red-400 hover:text-red-300 text-xs"
              >
                지우기
              </button>
            </div>
            <div className="space-y-1">
              {subtitleHistory
                .slice()
                .reverse()
                .map((item, index) => (
                  <div
                    key={index}
                    className="text-xs border-b border-gray-600 pb-1"
                  >
                    <div className="font-medium">{item.text}</div>
                    <div className="text-gray-400 text-xs">
                      {new Date(item.timestamp).toLocaleTimeString()}
                      {item.score !== undefined && (
                        <span className="ml-2">
                          신뢰도: {(item.score * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
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
            disabled={isMediaPipeInitializing}
          >
            <span className="hidden sm:inline">{getAIButtonText()}</span>
            <span className="sm:hidden">{getAIButtonIcon()}</span>
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
