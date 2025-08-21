// app/routes/call/$id?.tsx
import React, { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};

type IncomingCall = {
  from_user: string;
  room_id: string;
};

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const [userId] = useState(() => Math.floor(Math.random() * 10000).toString()); // 예시 user_id
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const WS_BASE_URL =
    import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

  // 1️⃣ 로컬 미디어 스트림 가져오기
  useEffect(() => {
    if (!roomId) return;
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
  }, [roomId]);

  // 2️⃣ WebSocket 연결
  useEffect(() => {
    if (!roomId) return;
    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${userId}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("WebSocket 연결 성공");

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "call_request":
          setIncomingCall({ from_user: msg.from_user, room_id: msg.room_id });
          break;

        case "offer":
          if (!localStream) return;
          const pc = createPeerConnection();
          pcRef.current = pc;
          localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsRef.current?.send(JSON.stringify({ type: "answer", sdp: answer }));
          setIncomingCall(null);
          break;

        case "answer":
          if (!pcRef.current) return;
          await pcRef.current.setRemoteDescription(
            new RTCSessionDescription(msg.sdp)
          );
          break;

        case "ice":
          if (!pcRef.current) return;
          try {
            await pcRef.current.addIceCandidate(
              new RTCIceCandidate(msg.candidate)
            );
          } catch (e) {
            console.error("ICE 추가 실패:", e);
          }
          break;
      }
    };

    ws.onclose = () => console.log("WebSocket 연결 종료");

    return () => ws.close();
  }, [roomId, localStream]);

  // 3️⃣ PeerConnection 생성
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

    return pc;
  };

  // 4️⃣ 통화 걸기 (caller)
  const callUser = async () => {
    if (!localStream || !wsRef.current) return;

    // 1:1 call_request 전송
    wsRef.current.send(
      JSON.stringify({ type: "call_request", room_id: roomId })
    );

    const pc = createPeerConnection();
    pcRef.current = pc;
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({ type: "offer", sdp: offer }));
  };

  const endCall = () => {
    pcRef.current?.close();
    wsRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());
  };

  if (!roomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
        <h1 className="text-xl mb-4">전화 준비 중...</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      <h1 className="text-xl mb-4">Room: {roomId}</h1>

      <div className="grid grid-cols-2 gap-4 w-full max-w-5xl">
        <div className="relative bg-gray-800 rounded-xl overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 left-2 text-sm bg-black/50 px-2 py-1 rounded">
            Me
          </span>
        </div>

        <div className="relative bg-gray-800 rounded-xl overflow-hidden">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          <span className="absolute bottom-2 left-2 text-sm bg-black/50 px-2 py-1 rounded">
            Remote
          </span>
        </div>
      </div>

      <div className="mt-6 flex gap-4">
        <Button onClick={callUser}>통화 걸기</Button>
        <Button variant="destructive" onClick={endCall}>
          통화 종료
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            localStream
              ?.getAudioTracks()
              .forEach((t) => (t.enabled = !t.enabled));
          }}
        >
          음소거
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            localStream
              ?.getVideoTracks()
              .forEach((t) => (t.enabled = !t.enabled));
          }}
        >
          카메라 끄기
        </Button>
      </div>

      {/* Incoming call modal */}
      {incomingCall && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white">
          <h2 className="text-xl mb-4">
            전화가 왔습니다: {incomingCall.from_user}
          </h2>
          <div className="flex gap-4">
            <Button onClick={callUser}>수락</Button>
            <Button variant="destructive" onClick={() => setIncomingCall(null)}>
              거절
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
