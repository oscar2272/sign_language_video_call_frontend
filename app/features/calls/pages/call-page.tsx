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
  const [isIncoming, setIsIncoming] = useState(false);
  const [callerName, setCallerName] = useState("");
  const [connectionTime, setConnectionTime] = useState(0);
  const [isInitiator, setIsInitiator] = useState(true); // 발신자인지 수신자인지 구분

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const connectionTimeRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC 설정
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
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

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setCallStatus("connected");
        startConnectionTimer();
      } else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        endCall();
      }
    };

    return pc;
  };

  // 미디어 스트림 초기화
  const initializeMedia = async () => {
    try {
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
      console.error("Error accessing media devices:", error);
      alert("카메라와 마이크 접근 권한이 필요합니다.");
      return null;
    }
  };

  // WebSocket 연결
  const connectWebSocket = () => {
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );

    ws.onopen = () => {
      console.log("WebSocket connected");
      // 발신자의 경우에만 call_request 전송
      if (isInitiator) {
        ws.send(
          JSON.stringify({
            type: "call_request",
            from_user_name: user.profile?.nickname || "Unknown",
          })
        );
      }
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      console.log("WebSocket message received:", data);

      switch (data.type) {
        case "call_request":
          // 수신자만 수신 전화로 처리
          if (!isInitiator) {
            setIsIncoming(true);
            setCallerName(data.from_user_name || "Unknown");
          }
          break;

        case "accepted":
          console.log("Call accepted, creating offer...");
          setCallStatus("connecting");
          setIsIncoming(false);
          // PeerConnection과 로컬 스트림이 준비된 후 offer 생성
          setTimeout(() => createOffer(), 100);
          break;

        case "rejected":
          console.log("Call rejected");
          setCallStatus("rejected");
          setTimeout(() => navigate("/friends"), 2000);
          break;

        case "offer":
          console.log("Received offer:", data.offer);
          await handleOffer(data.offer);
          break;

        case "answer":
          console.log("Received answer:", data.answer);
          await handleAnswer(data.answer);
          break;

        case "ice":
          console.log("Received ICE candidate:", data.candidate);
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
      console.log("WebSocket disconnected");
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return ws;
  };

  // Offer 생성 (발신자)
  const createOffer = async () => {
    console.log("Creating offer...");
    if (!pcRef.current || !localStream) {
      console.log("PeerConnection or localStream not ready");
      return;
    }

    // 로컬 스트림 트랙들을 PeerConnection에 추가
    localStream.getTracks().forEach((track) => {
      console.log("Adding track to peer connection:", track.kind);
      pcRef.current!.addTrack(track, localStream);
    });

    try {
      const offer = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pcRef.current.setLocalDescription(offer);
      console.log("Offer created and set as local description");

      if (wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "offer",
            offer: offer,
          })
        );
        console.log("Offer sent via WebSocket");
      }
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  };

  // Offer 처리 (수신자)
  const handleOffer = async (offer: RTCSessionDescriptionInit) => {
    console.log("Handling offer...");
    if (!pcRef.current || !localStream) {
      console.log("PeerConnection or localStream not ready for handling offer");
      return;
    }

    // 로컬 스트림 트랙들을 PeerConnection에 추가
    localStream.getTracks().forEach((track) => {
      console.log("Adding track to peer connection:", track.kind);
      pcRef.current!.addTrack(track, localStream);
    });

    try {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      console.log("Remote description set");

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      console.log("Answer created and set as local description");

      if (wsRef.current) {
        wsRef.current.send(
          JSON.stringify({
            type: "answer",
            answer: answer,
          })
        );
        console.log("Answer sent via WebSocket");
      }
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  };

  // Answer 처리
  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    console.log("Handling answer...");
    if (!pcRef.current) {
      console.log("PeerConnection not ready for handling answer");
      return;
    }

    try {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer)
      );
      console.log("Remote description (answer) set successfully");
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  };

  // ICE Candidate 처리
  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) {
      console.log("PeerConnection not ready for ICE candidate");
      return;
    }

    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      console.log("ICE candidate added successfully");
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  };

  // 연결 시간 타이머
  const startConnectionTimer = () => {
    connectionTimeRef.current = setInterval(() => {
      setConnectionTime((prev) => prev + 1);
    }, 1000);
  };

  // 통화 수락
  const acceptCall = async () => {
    console.log("Accepting call...");
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "accepted" }));
    }

    // ✅ API 호출 제거 - 중복 생성 방지
    // accept API는 IncomingCallModal에서 이미 호출되었음

    setIsIncoming(false);
    setCallStatus("connecting");
  };

  // 통화 거절
  const rejectCall = async () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "rejected" }));
    }

    try {
      await fetch(`${CALL_API_URL}/reject/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: roomId,
          caller_id: user.id,
        }),
      });
    } catch (err) {
      console.error("거절 기록 실패:", err);
    }

    setCallStatus("rejected");
    setTimeout(() => navigate("/friends"), 2000);
  };

  // 통화 종료
  const endCall = async () => {
    if (wsRef.current) {
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
      console.error("Failed to end call:", err);
    }

    setTimeout(() => navigate("/friends"), 2000);
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

  // 정리 함수
  const cleanup = () => {
    if (connectionTimeRef.current) {
      clearInterval(connectionTimeRef.current);
    }

    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }

    if (pcRef.current) {
      pcRef.current.close();
    }

    if (wsRef.current) {
      wsRef.current.close();
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

    // URL에서 현재 사용자가 발신자인지 수신자인지 판단
    // 친구 페이지에서 "통화하기" 버튼을 누른 사용자는 발신자
    // IncomingCallModal에서 "수락" 버튼을 누른 사용자는 수신자
    const urlParams = new URLSearchParams(window.location.search);
    const isReceiver = urlParams.get("receiver") === "true";
    setIsInitiator(!isReceiver);

    const init = async () => {
      const stream = await initializeMedia();
      if (!stream) return;

      pcRef.current = createPeerConnection();
      wsRef.current = connectWebSocket();
    };

    init();

    return cleanup;
  }, [roomId]);

  // 원격 비디오 스트림 설정
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // 수신 전화 UI
  if (isIncoming) {
    return (
      <div className="fixed inset-0 bg-gray-900 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full mx-4">
          <div className="mb-6">
            <div className="w-24 h-24 bg-gray-300 rounded-full mx-auto mb-4 flex items-center justify-center text-4xl">
              👤
            </div>
            <h2 className="text-2xl font-bold mb-2">{callerName}</h2>
            <p className="text-gray-600">전화가 왔습니다</p>
          </div>

          <div className="flex gap-4 justify-center">
            <Button
              onClick={rejectCall}
              variant="destructive"
              className="w-16 h-16 rounded-full text-2xl"
            >
              📞
            </Button>
            <Button
              onClick={acceptCall}
              className="w-16 h-16 rounded-full text-2xl bg-green-500 hover:bg-green-600"
            >
              📞
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col">
      {/* 상태 표시 */}
      <div className="bg-gray-800 text-white p-4 text-center">
        {callStatus === "calling" && <span>전화 거는 중...</span>}
        {callStatus === "connecting" && <span>연결 중...</span>}
        {callStatus === "connected" && (
          <span>통화 중 - {formatTime(connectionTime)}</span>
        )}
        {callStatus === "rejected" && <span>통화가 거절되었습니다</span>}
        {callStatus === "ended" && <span>통화가 종료되었습니다</span>}
      </div>

      {/* 비디오 영역 */}
      <div className="flex-1 relative">
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
          className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg object-cover border-2 border-white"
          style={{ transform: "scaleX(-1)" }}
        />

        {/* 연결 대기 중일 때 플레이스홀더 */}
        {!remoteStream &&
          callStatus !== "ended" &&
          callStatus !== "rejected" && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-xl">
              상대방을 기다리는 중...
            </div>
          )}
      </div>

      {/* 컨트롤 버튼 */}
      <div className="bg-gray-800 p-6">
        <div className="flex justify-center gap-4">
          <Button
            onClick={toggleMic}
            variant={isMicOn ? "default" : "destructive"}
            className="w-14 h-14 rounded-full text-xl"
          >
            {isMicOn ? "🎤" : "🔇"}
          </Button>

          <Button
            onClick={toggleCamera}
            variant={isCameraOn ? "default" : "destructive"}
            className="w-14 h-14 rounded-full text-xl"
          >
            {isCameraOn ? "📹" : "📷"}
          </Button>

          <Button
            onClick={endCall}
            variant="destructive"
            className="w-14 h-14 rounded-full text-xl"
          >
            📞
          </Button>
        </div>
      </div>
    </div>
  );
}
