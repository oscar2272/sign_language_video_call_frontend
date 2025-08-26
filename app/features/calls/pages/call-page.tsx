import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext, useNavigate } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL;
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
    "calling" | "accepted" | "ended"
  >("calling");
  const [isCameraOn, setIsCameraOn] = useState(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // -------------------------------
  // 1️⃣ 로컬 스트림 초기화
  // -------------------------------
  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.error("미디어 접근 실패:", err);
      }
    };
    initMedia();
  }, []);

  // -------------------------------
  // 2️⃣ WebSocket 연결
  // -------------------------------
  useEffect(() => {
    if (!roomId) return;
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("WS 연결됨:", roomId);

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
        endCall();
      } else if (type === "rejected") {
        alert("상대방이 전화를 거절했습니다.");
        navigate(-1);
      }
    };

    ws.onclose = () => console.log("WS 종료");

    return () => ws.close();
  }, [roomId]);

  // -------------------------------
  // 3️⃣ RTCPeerConnection 초기화
  // -------------------------------
  useEffect(() => {
    if (!localStream) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // 로컬 스트림 트랙 추가
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    // 원격 스트림 이벤트
    const remote = new MediaStream();
    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remote.addTrack(track));
      setRemoteStream(remote);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;
    };

    // ICE candidate WS 전송
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        wsRef.current?.send(
          JSON.stringify({ type: "ice", candidate: event.candidate })
        );
      }
    };
  }, [localStream]);

  // -------------------------------
  // 4️⃣ offer/answer/ice 핸들러
  // -------------------------------
  const handleOffer = async (data: any) => {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    wsRef.current?.send(JSON.stringify({ type: "answer", answer }));
    setCallStatus("accepted");
  };

  const handleAnswer = async (data: any) => {
    if (!pcRef.current) return;
    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(data.answer)
    );
    setCallStatus("accepted");
  };

  const handleICE = async (data: any) => {
    if (!pcRef.current) return;
    try {
      await pcRef.current.addIceCandidate(data.candidate);
    } catch (err) {
      console.error("ICE 추가 실패:", err);
    }
  };

  // -------------------------------
  // 5️⃣ 통화 종료
  // -------------------------------
  const endCall = () => {
    setCallStatus("ended");
    pcRef.current?.close();
    wsRef.current?.send(JSON.stringify({ type: "end_call" }));
    navigate(-1);
  };

  // -------------------------------
  // 6️⃣ UI
  // -------------------------------
  return (
    <div className="flex flex-col items-center justify-center h-full p-4">
      <div className="flex gap-2 mb-4">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          className="w-40 h-60 bg-black rounded-md"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          className="w-40 h-60 bg-black rounded-md"
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setIsCameraOn(!isCameraOn)}>
          {isCameraOn ? "카메라 끄기" : "카메라 켜기"}
        </Button>
        <Button variant="destructive" onClick={endCall}>
          통화 종료
        </Button>
      </div>

      <p className="mt-2 text-sm text-gray-500">
        상태: {callStatus.toUpperCase()}
      </p>
    </div>
  );
}
