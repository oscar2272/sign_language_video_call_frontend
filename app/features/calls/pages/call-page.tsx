import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";

const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({
  loaderData,
}: {
  loaderData: { roomId: string };
}) {
  const { roomId } = loaderData;
  const { user } = useOutletContext<{ user: UserProfile; token: string }>();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // 1️⃣ 로컬 스트림 가져오기
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

      if (type === "offer") await handleOffer(data);
      else if (type === "answer") await handleAnswer(data);
      else if (type === "ice") await handleICE(data);
      else if (type === "end_call") handleEndCall();
      else if (type === "rejected") setCallStatus("rejected");
    };

    return () => ws.close();
  }, [roomId, user.id, localStream]);

  // 3️⃣ PeerConnection 초기화
  const initPeerConnection = (stream: MediaStream) => {
    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // 로컬 트랙 추가
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    // 원격 트랙 수신
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteStream) {
        setRemoteStream(remoteStream);
        if (remoteVideoRef.current)
          remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate)
        sendSignal({ type: "ice", candidate: event.candidate });
    };

    return pc;
  };

  // 4️⃣ 신호 전송
  const sendSignal = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  // 5️⃣ Offer 처리
  const handleOffer = async (data: any) => {
    if (!localStream) return; // 로컬 스트림 준비 후 처리
    const pc = initPeerConnection(localStream);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: "answer", answer });
    setCallStatus("accepted");
  };

  // 6️⃣ Answer 처리
  const handleAnswer = async (data: any) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    setCallStatus("accepted");
  };

  // 7️⃣ ICE 처리
  const handleICE = async (data: any) => {
    try {
      const pc = pcRef.current;
      if (!pc) return;
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error("ICE candidate 추가 실패:", err);
    }
  };

  // 8️⃣ 통화 종료 처리
  const handleEndCall = () => {
    setCallStatus("ended");
    pcRef.current?.close();
    pcRef.current = null;
  };

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
