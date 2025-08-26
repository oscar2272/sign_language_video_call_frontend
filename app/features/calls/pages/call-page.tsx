import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate, useParams } from "react-router";
import type { UserProfile } from "~/features/profiles/type";

// Route 타입이 없는 경우를 위한 대체
interface LoaderData {
  roomId: string | null;
}

interface ComponentProps {
  loaderData: LoaderData;
}

export const loader = async ({ params }: { params: { id?: string } }) => {
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({ loaderData }: ComponentProps) {
  const params = useParams();
  const roomId = loaderData?.roomId || params.id || null;
  const navigate = useNavigate();
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [ended, setEnded] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC 설정
  const pcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  // 컴포넌트 정리 함수
  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
  };

  // 미디어 스트림 초기화
  const initializeMedia = async () => {
    try {
      // 브라우저 호환성 체크
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("이 브라우저는 미디어 접근을 지원하지 않습니다.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (error) {
      console.error("미디어 접근 실패:", error);
      // 에러를 던지지 않고 null 반환으로 변경
      setCallStatus("ended");
      return null;
    }
  };

  // WebSocket 초기화
  const initializeWebSocket = () => {
    const wsUrl = `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket 연결됨");
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("수신한 메시지:", data);

      switch (data.type) {
        case "call_request":
          // 발신자가 받는 경우는 없음 (이미 통화 페이지에 있음)
          break;

        case "accepted":
          setCallStatus("accepted");
          startCallTimer();
          await createOffer();
          break;

        case "rejected":
          setCallStatus("rejected");
          setTimeout(() => {
            navigate("/friends");
          }, 2000);
          break;

        case "offer":
          await handleOffer(data.offer);
          break;

        case "answer":
          await handleAnswer(data.answer);
          break;

        case "ice":
          await handleIceCandidate(data.candidate);
          break;

        case "end_call":
          setCallStatus("ended");
          setEnded(true);
          cleanup();
          setTimeout(() => {
            navigate("/friends");
          }, 2000);
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket 연결 종료");
    };

    ws.onerror = (error) => {
      console.error("WebSocket 에러:", error);
    };

    wsRef.current = ws;
  };

  // RTCPeerConnection 초기화
  const initializePeerConnection = (stream: MediaStream) => {
    const pc = new RTCPeerConnection(pcConfig);

    // 로컬 스트림 추가
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // ICE candidate 이벤트
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice",
            candidate: event.candidate,
          })
        );
      }
    };

    // 원격 스트림 수신
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      setRemoteStream(remoteStream);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    pcRef.current = pc;
  };

  // Offer 생성
  const createOffer = async () => {
    if (!pcRef.current || !wsRef.current) return;

    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      wsRef.current.send(
        JSON.stringify({
          type: "offer",
          offer: offer,
        })
      );
    } catch (error) {
      console.error("Offer 생성 실패:", error);
    }
  };

  // Offer 처리
  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    if (!pcRef.current || !wsRef.current) return;

    try {
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      wsRef.current.send(
        JSON.stringify({
          type: "answer",
          answer: answer,
        })
      );
    } catch (error) {
      console.error("Offer 처리 실패:", error);
    }
  };

  // Answer 처리
  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (!pcRef.current) return;

    try {
      await pcRef.current.setRemoteDescription(answer);
    } catch (error) {
      console.error("Answer 처리 실패:", error);
    }
  };

  // ICE Candidate 처리
  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) return;

    try {
      await pcRef.current.addIceCandidate(candidate);
    } catch (error) {
      console.error("ICE candidate 처리 실패:", error);
    }
  };

  // 통화 시간 측정 시작
  const startCallTimer = () => {
    durationIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  // 통화 종료
  const endCall = async () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "end_call" }));
    }
    setCallStatus("ended");
    setEnded(true);
    cleanup();

    try {
      const response = await fetch(`${CALL_API_URL}/end/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room_id: roomId }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (err) {
      console.error("Failed to end call:", err);
    }

    setTimeout(() => {
      navigate("/friends");
    }, 2000);
  };

  // 카메라 토글
  const toggleCamera = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  // 마이크 토글
  const toggleMic = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  // 시간 포맷팅
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 초기화
  useEffect(() => {
    if (!roomId) {
      navigate("/friends");
      return;
    }

    // user나 token이 없는 경우 처리
    if (!user?.id || !token) {
      console.log("User 또는 token이 없음:", {
        user: user?.id,
        hasToken: !!token,
      });
      // navigate("/friends"); // 주석 처리해서 에러 방지
      return;
    }

    const initialize = async () => {
      try {
        const stream = await initializeMedia();
        if (stream) {
          initializeWebSocket();
          initializePeerConnection(stream);
        } else {
          console.log("미디어 초기화 실패");
        }
      } catch (error) {
        console.error("초기화 실패:", error);
        setCallStatus("ended");
      }
    };

    initialize();

    return cleanup;
  }, [roomId, user?.id, token]);

  if (!roomId) {
    return <div>잘못된 통화방입니다.</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      {/* 헤더 */}
      <div className="flex justify-between items-center p-4 bg-gray-800">
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold">화상 통화</h1>
          {callStatus === "accepted" && (
            <span className="text-sm text-green-400">
              통화 중 - {formatDuration(callDuration)}
            </span>
          )}
          {callStatus === "calling" && (
            <span className="text-sm text-yellow-400">연결 중...</span>
          )}
          {callStatus === "rejected" && (
            <span className="text-sm text-red-400">통화가 거절되었습니다</span>
          )}
          {callStatus === "ended" && (
            <span className="text-sm text-gray-400">통화가 종료되었습니다</span>
          )}
        </div>
        <div className="text-sm text-gray-300">Room: {roomId}</div>
      </div>

      {/* 비디오 영역 */}
      <div className="flex-1 relative">
        {/* 원격 비디오 (메인) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-gray-800"
        />

        {/* 로컬 비디오 (작은 창) */}
        <div className="absolute top-4 right-4 w-32 h-24 bg-gray-700 rounded-lg overflow-hidden border-2 border-gray-500">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>

        {/* 연결 상태 메시지 */}
        {callStatus === "calling" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <div className="text-center">
              <div className="animate-pulse text-2xl mb-4">📞</div>
              <div className="text-lg">상대방을 기다리는 중...</div>
            </div>
          </div>
        )}

        {callStatus === "rejected" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <div className="text-center">
              <div className="text-2xl mb-4">❌</div>
              <div className="text-lg">통화가 거절되었습니다</div>
              <div className="text-sm text-gray-300 mt-2">
                친구 목록으로 돌아갑니다...
              </div>
            </div>
          </div>
        )}

        {callStatus === "ended" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
            <div className="text-center">
              <div className="text-2xl mb-4">📞</div>
              <div className="text-lg">통화가 종료되었습니다</div>
              <div className="text-sm text-gray-300 mt-2">
                친구 목록으로 돌아갑니다...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="flex justify-center items-center gap-4 p-6 bg-gray-800">
        <Button
          onClick={toggleMic}
          variant={isMicOn ? "default" : "destructive"}
          size="lg"
          className="w-12 h-12 rounded-full"
          disabled={ended}
        >
          {isMicOn ? "🎤" : "🎤"}
        </Button>

        <Button
          onClick={toggleCamera}
          variant={isCameraOn ? "default" : "destructive"}
          size="lg"
          className="w-12 h-12 rounded-full"
          disabled={ended}
        >
          {isCameraOn ? "📹" : "📹"}
        </Button>

        <Button
          onClick={endCall}
          variant="destructive"
          size="lg"
          className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-700"
          disabled={ended}
        >
          📞
        </Button>
      </div>
    </div>
  );
}
