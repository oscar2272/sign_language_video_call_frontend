import React, { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";
import { Button } from "~/common/components/ui/button";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

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

  // ---------------------------
  // WebSocket 연결
  // ---------------------------
  useEffect(() => {
    if (!roomId || !token) return;

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("WebSocket connected");
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case "offer":
          await handleOffer(data);
          break;
        case "answer":
          await handleAnswer(data);
          break;
        case "ice":
          if (data.candidate) {
            await pcRef.current?.addIceCandidate(
              new RTCIceCandidate(data.candidate)
            );
          }
          break;
        case "end_call":
          endCall();
          break;
        case "rejected":
          alert("상대방이 전화를 거절했습니다.");
          endCall();
          break;
        default:
          break;
      }
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
    };

    return () => {
      ws.close();
    };
  }, [roomId, token]);

  // ---------------------------
  // WebRTC 설정
  // ---------------------------
  useEffect(() => {
    const setupLocalStream = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // ICE 후보
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current) {
          wsRef.current.send(
            JSON.stringify({ type: "ice", candidate: event.candidate })
          );
        }
      };

      // 원격 스트림
      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current)
          remoteVideoRef.current.srcObject = event.streams[0];
      };

      // 로컬 스트림 트랙 추가
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    };

    setupLocalStream();

    return () => {
      pcRef.current?.close();
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---------------------------
  // Offer 처리
  // ---------------------------
  const handleOffer = async (data: any) => {
    if (!pcRef.current) return;

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    wsRef.current?.send(JSON.stringify({ type: "answer", sdp: answer }));
    setCallStatus("accepted");
  };

  const handleAnswer = async (data: any) => {
    if (!pcRef.current) return;

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(data.sdp)
    );
    setCallStatus("accepted");
  };

  // ---------------------------
  // 통화 종료
  // ---------------------------
  const endCall = () => {
    setCallStatus("ended");
    pcRef.current?.close();
    wsRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());
  };

  // ---------------------------
  // UI
  // ---------------------------
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 gap-2">
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
      <div className="flex gap-2 mt-4">
        <Button onClick={() => setIsCameraOn((prev) => !prev)}>
          {isCameraOn ? "카메라 끄기" : "카메라 켜기"}
        </Button>
        <Button onClick={endCall} variant="destructive">
          통화 종료
        </Button>
      </div>
      <p className="mt-2">
        {callStatus === "calling"
          ? "연결 중..."
          : callStatus === "accepted"
            ? "통화 중"
            : "통화 종료"}
      </p>
    </div>
  );
}
