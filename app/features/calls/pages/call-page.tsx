import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

interface Props {
  roomId: string;
}

export default function CallPage({ roomId }: Props) {
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callStatus, setCallStatus] = useState<
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const userId = user.id.toString();

  // ✅ WebSocket 연결
  useEffect(() => {
    wsRef.current = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${userId}`
    );

    wsRef.current.onopen = () => console.log("WS Connected");
    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const type = data.type;

      switch (type) {
        case "call_request":
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
          break;
        case "rejected":
          setCallStatus("rejected");
          cleanup();
          break;
        case "end_call":
          setCallStatus("ended");
          cleanup();
          break;
      }
    };

    wsRef.current.onclose = () => console.log("WS Disconnected");

    return () => {
      wsRef.current?.close();
    };
  }, [roomId]);

  // ✅ 로컬 미디어 가져오기
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
        console.error("Failed to get local media:", err);
      }
    };
    initLocalStream();
  }, []);

  // ✅ PeerConnection 생성
  const initPeerConnection = () => {
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send(
          JSON.stringify({ type: "ice", candidate: event.candidate })
        );
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current)
        remoteVideoRef.current.srcObject = event.streams[0];
    };

    localStream
      ?.getTracks()
      .forEach((track) => pc.addTrack(track, localStream));

    pcRef.current = pc;
  };

  // ✅ Offer 처리
  const handleOffer = async (data: any) => {
    initPeerConnection();
    const pc = pcRef.current!;
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsRef.current?.send(JSON.stringify({ type: "answer", answer }));
  };

  // ✅ Answer 처리
  const handleAnswer = async (data: any) => {
    const pc = pcRef.current!;
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  };

  // ✅ ICE 후보 처리
  const handleIce = async (data: any) => {
    const pc = pcRef.current!;
    if (data.candidate) await pc.addIceCandidate(data.candidate);
  };

  // ✅ 통화 종료
  const endCall = () => {
    wsRef.current?.send(JSON.stringify({ type: "end_call" }));
    setCallStatus("ended");
    cleanup();
  };

  // ✅ 정리
  const cleanup = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemoteStream(null);
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100">
      <div className="flex gap-4">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          className="w-48 h-64 bg-black rounded"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          className="w-48 h-64 bg-black rounded"
        />
      </div>

      <div className="mt-4 flex gap-2">
        {callStatus === "calling" && <p>통화 대기 중...</p>}
        {callStatus === "accepted" && <p>통화 중</p>}
        {callStatus === "rejected" && <p>상대방이 거절했습니다.</p>}
        {callStatus === "ended" && <p>통화 종료</p>}
      </div>

      {callStatus === "accepted" && (
        <Button variant="destructive" onClick={endCall} className="mt-4">
          통화 종료
        </Button>
      )}
    </div>
  );
}
