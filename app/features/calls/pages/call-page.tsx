import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import { useOutletContext } from "react-router";
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
  const [userId] = useState(() => Math.floor(Math.random() * 10000).toString());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isCameraOn, setIsCameraOn] = useState(true);

  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // ✅ 로컬 스트림 가져오기
  useEffect(() => {
    async function initLocalStream() {
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
    }
    initLocalStream();
  }, []);

  // ✅ PeerConnection 생성
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ontrack = (event) => {
      if (remoteVideoRef.current)
        remoteVideoRef.current.srcObject = event.streams[0];
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({ type: "ice", candidate: event.candidate })
        );
      }
    };

    if (localStream)
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    return pc;
  };

  // ✅ WebSocket + WebRTC
  useEffect(() => {
    if (!roomId || !localStream) return;

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${userId}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ Room WS connected");
      const pc = createPeerConnection();
      pcRef.current = pc;

      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", sdp: offer }));
      });
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "offer") {
        const pc = createPeerConnection();
        pcRef.current = pc;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sdp: answer }));
      } else if (msg.type === "answer" && pcRef.current) {
        await pcRef.current.setRemoteDescription(
          new RTCSessionDescription(msg.sdp)
        );
      } else if (msg.type === "ice" && pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(
            new RTCIceCandidate(msg.candidate)
          );
        } catch (e) {
          console.error("ICE 추가 실패:", e);
        }
      }
    };

    ws.onclose = () => console.log("❌ Room WS disconnected");
    return () => ws.close();
  }, [roomId, localStream]);

  // ✅ 통화 종료
  const endCall = async () => {
    pcRef.current?.close();
    wsRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());

    try {
      const res = await fetch(`${CALL_API_URL}/end/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ room_id: roomId, used_credits: "0" }),
      });
      if (!res.ok) throw new Error("통화 종료 기록 실패");
      console.log("통화 종료 기록 성공");
    } catch (err) {
      console.error(err);
    }
  };

  // ✅ 카메라 토글
  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setIsCameraOn(track.enabled);
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <h1 className="text-xl mb-4">Room: {roomId}</h1>
      <div className="grid grid-cols-2 gap-4 w-full max-w-5xl">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover rounded-xl bg-gray-800"
        />
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover rounded-xl bg-gray-800"
        />
      </div>
      <div className="mt-6 flex gap-4">
        <Button onClick={toggleCamera}>
          {isCameraOn ? "카메라 끄기" : "카메라 켜기"}
        </Button>
        <Button variant="destructive" onClick={endCall}>
          통화 종료
        </Button>
      </div>
    </div>
  );
}
