import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();
  const navigate = useNavigate();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "connecting" | "calling" | "accepted" | "rejected" | "ended"
  >("connecting");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [ended, setEnded] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // WebSocket 연결 설정
  const initWebSocket = () => {
    if (!roomId || !user) return;

    const wsUrl = `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`;
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log("WebSocket connected");
      setCallStatus("calling");
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "offer":
          await handleOffer(data);
          break;
        case "answer":
          await handleAnswer(data);
          break;
        case "ice":
          await handleIce(data);
          break;
        case "accepted":
          setCallStatus("accepted");
          startCallTimer();
          break;
        case "rejected":
          setCallStatus("rejected");
          setTimeout(() => {
            navigate("/");
          }, 2000);
          break;
        case "end_call":
          setCallStatus("ended");
          setEnded(true);
          cleanup();
          setTimeout(() => {
            navigate("/");
          }, 2000);
          break;
      }
    };

    wsRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    wsRef.current.onclose = () => {
      console.log("WebSocket closed");
    };
  };

  // WebRTC 연결 설정
  const initPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

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

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pcRef.current = pc;
  };

  // 미디어 스트림 가져오기
  const initMediaStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // PeerConnection에 트랙 추가
      if (pcRef.current) {
        stream.getTracks().forEach((track) => {
          pcRef.current?.addTrack(track, stream);
        });
      }

      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("카메라와 마이크 접근 권한이 필요합니다.");
      navigate("/");
    }
  };

  // Offer 처리
  const handleOffer = async (data: any) => {
    if (!pcRef.current) return;

    await pcRef.current.setRemoteDescription(data.offer);
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "answer",
          answer: answer,
        })
      );
    }
  };

  // Answer 처리
  const handleAnswer = async (data: any) => {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(data.answer);
  };

  // ICE candidate 처리
  const handleIce = async (data: any) => {
    if (!pcRef.current) return;
    await pcRef.current.addIceCandidate(data.candidate);
  };

  // Offer 생성 및 전송
  const makeOffer = async () => {
    if (!pcRef.current) return;

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    if (wsRef.current) {
      wsRef.current.send(
        JSON.stringify({
          type: "offer",
          offer: offer,
        })
      );
    }
  };

  // 통화 시간 타이머 시작
  const startCallTimer = () => {
    callStartTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const elapsed = Math.floor(
          (Date.now() - callStartTimeRef.current) / 1000
        );
        setCallDuration(elapsed);
      }
    }, 1000);
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
      alert("Failed to end call. Please try again.");
    }

    setTimeout(() => {
      navigate("/");
    }, 2000);
  };

  // 리소스 정리
  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
    }
  };

  // 시간 포맷팅
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // 컴포넌트 마운트 시 초기화
  useEffect(() => {
    if (!roomId || !user) {
      navigate("/");
      return;
    }

    const init = async () => {
      initPeerConnection();
      await initMediaStream();
      initWebSocket();
    };

    init();

    return () => {
      cleanup();
    };
  }, [roomId, user, navigate]);

  // 연결 후 Offer 생성
  useEffect(() => {
    if (callStatus === "calling" && pcRef.current && localStream) {
      // 약간의 딜레이 후 offer 생성 (상대방 준비 대기)
      setTimeout(() => {
        makeOffer();
      }, 1000);
    }
  }, [callStatus, localStream]);

  // remoteStream이 설정되면 비디오 요소에 연결
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (!roomId) {
    return <div>잘못된 통화 ID입니다.</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* 상태 표시 */}
      <div className="flex justify-between items-center p-4 bg-gray-900">
        <div className="text-sm">
          {callStatus === "connecting" && "연결 중..."}
          {callStatus === "calling" && "통화 중..."}
          {callStatus === "accepted" &&
            `통화 시간: ${formatDuration(callDuration)}`}
          {callStatus === "rejected" && "통화가 거절되었습니다"}
          {callStatus === "ended" && "통화가 종료되었습니다"}
        </div>
        <div className="text-sm">Room ID: {roomId}</div>
      </div>

      {/* 비디오 영역 */}
      <div className="flex-1 relative">
        {/* 원격 비디오 (전체 화면) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />

        {/* 로컬 비디오 (PiP) */}
        <div className="absolute top-4 right-4 w-40 h-30 bg-gray-800 rounded-lg overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {!isCameraOn && (
            <div className="absolute inset-0 bg-gray-700 flex items-center justify-center">
              <span className="text-xs">카메라 꺼짐</span>
            </div>
          )}
        </div>

        {/* 상태별 오버레이 */}
        {(callStatus === "calling" || callStatus === "connecting") &&
          !remoteStream && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                <p className="text-lg">
                  {callStatus === "connecting"
                    ? "연결 중..."
                    : "상대방을 기다리는 중..."}
                </p>
              </div>
            </div>
          )}

        {callStatus === "rejected" && (
          <div className="absolute inset-0 bg-red-600 bg-opacity-80 flex items-center justify-center">
            <div className="text-center">
              <p className="text-xl mb-2">❌</p>
              <p className="text-lg">통화가 거절되었습니다</p>
              <p className="text-sm">곧 이전 페이지로 돌아갑니다...</p>
            </div>
          </div>
        )}

        {ended && (
          <div className="absolute inset-0 bg-gray-800 bg-opacity-80 flex items-center justify-center">
            <div className="text-center">
              <p className="text-xl mb-2">📞</p>
              <p className="text-lg">통화가 종료되었습니다</p>
              <p className="text-sm">곧 이전 페이지로 돌아갑니다...</p>
            </div>
          </div>
        )}
      </div>

      {/* 컨트롤 버튼 */}
      {callStatus !== "ended" && callStatus !== "rejected" && !ended && (
        <div className="flex justify-center items-center p-6 bg-gray-900 gap-4">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            size="lg"
            className="rounded-full w-16 h-16"
          >
            {isMicOn ? "🎤" : "🔇"}
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            size="lg"
            className="rounded-full w-20 h-20 text-2xl"
          >
            📞
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            size="lg"
            className="rounded-full w-16 h-16"
          >
            {isCameraOn ? "📹" : "📷"}
          </Button>
        </div>
      )}
    </div>
  );
}
