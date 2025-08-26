import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({
  loaderData,
}: {
  loaderData: { roomId: string };
}) {
  const { roomId } = loaderData;
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

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // 1️⃣ 로컬 미디어 스트림 초기화
  useEffect(() => {
    const initLocalStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.error("카메라/마이크 접근 실패:", err);
      }
    };
    initLocalStream();
  }, []);

  // 2️⃣ WebSocket 연결
  useEffect(() => {
    if (!roomId || !user.id) return;

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("WebSocket 연결됨");
    ws.onclose = () => console.log("WebSocket 종료");
    ws.onerror = (err) => console.error("WebSocket 에러", err);

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const type = data.type;

      if (type === "offer") {
        await handleOffer(data);
      } else if (type === "answer") {
        await handleAnswer(data);
      } else if (type === "ice") {
        await handleICE(data);
      } else if (type === "end_call") {
        handleEndCall();
      } else if (type === "rejected") {
        setCallStatus("rejected");
      }
    };

    return () => ws.close();
  }, [roomId, user.id]);

  // 3️⃣ RTCPeerConnection 초기화
  const initPeerConnection = () => {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    if (localStream) {
      localStream
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current)
        remoteVideoRef.current.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: "ice", candidate: event.candidate });
      }
    };

    return pc;
  };

  // 4️⃣ 신호 보내기
  const sendSignal = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  // 5️⃣ Offer/Answer 처리
  const handleOffer = async (data: any) => {
    const pc = initPeerConnection();
    await pc.setRemoteDescription(data.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: "answer", answer });
    setCallStatus("accepted");
  };

  const handleAnswer = async (data: any) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(data.answer);
    setCallStatus("accepted");
  };

  const handleICE = async (data: any) => {
    try {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.addIceCandidate(data.candidate);
    } catch (err) {
      console.error("ICE candidate 추가 실패:", err);
    }
  };

  const handleEndCall = () => {
    setCallStatus("ended");
    pcRef.current?.close();
    pcRef.current = null;
  };

  // 6️⃣ 수동 종료 버튼
  const endCall = () => {
    sendSignal({ type: "end_call" });
    handleEndCall();
  };

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100">
      <div className="flex gap-2">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          className="w-48 h-36 bg-black rounded"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          className="w-48 h-36 bg-black rounded"
        />
      </div>

      <div className="mt-4 flex gap-2">
        {callStatus === "accepted" && (
          <Button onClick={endCall} variant="destructive">
            통화 종료
          </Button>
        )}
      </div>

      <p className="mt-2 text-sm text-gray-600">상태: {callStatus}</p>
    </div>
  );
}
