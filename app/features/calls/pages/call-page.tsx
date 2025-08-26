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
  const [ended, setEnded] = useState(false);
  const [callStatus, setCallStatus] = useState<
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");

  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // 1️⃣ 로컬 스트림 가져오기
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

  // 2️⃣ PeerConnection 생성 + 트랙 추가 (stream 필요)
  const createPeerConnection = (stream: MediaStream) => {
    if (pcRef.current) return pcRef.current;

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

    // ✅ stream이 존재할 때만 track 추가
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pcRef.current = pc;
    return pc;
  };

  // 3️⃣ WebSocket 연결 + 메시지 처리
  useEffect(() => {
    if (!roomId || !localStream) return;

    const pc = createPeerConnection(localStream);

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${userId}`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("✅ WS connected");
      ws.send(JSON.stringify({ type: "call_request" }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      console.log("WS 메시지:", msg);

      switch (msg.type) {
        case "call_request":
          ws.send(JSON.stringify({ type: "accepted" }));
          setCallStatus("accepted");
          break;

        case "accepted":
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: "offer", sdp: offer }));
          setCallStatus("accepted");
          break;

        case "offer":
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: "answer", sdp: answer }));
          setCallStatus("accepted");
          break;

        case "answer":
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
          break;

        case "ice":
          try {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch (e) {
            console.error("ICE 추가 실패:", e);
          }
          break;

        case "rejected":
          setCallStatus("rejected");
          break;

        case "end_call":
          if (!ended) {
            setEnded(true);
            setCallStatus("ended");
            pc.close();
            localStream.getTracks().forEach((t) => t.stop());
            ws.close();
            alert("상대방이 통화를 종료했습니다.");
          }
          break;
      }
    };

    ws.onclose = () => console.log("❌ WS disconnected");

    return () => {
      pc.close();
      localStream.getTracks().forEach((t) => t.stop());
      ws.close();
    };
  }, [roomId, localStream, ended]);

  // 4️⃣ 통화 종료
  const endCall = async () => {
    if (ended) return;
    setEnded(true);
    setCallStatus("ended");

    wsRef.current?.send(JSON.stringify({ type: "end_call" }));

    pcRef.current?.close();
    localStream?.getTracks().forEach((t) => t.stop());
    wsRef.current?.close();

    if (!roomId) return;
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

  // 5️⃣ 카메라 토글
  const toggleCamera = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setIsCameraOn(track.enabled);
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
      {callStatus === "calling" && (
        <p className="text-lg mb-4">📞 전화를 걸고 있습니다 ...</p>
      )}
      {callStatus === "rejected" && (
        <p className="text-lg mb-4 text-red-500">
          ❌ 상대방이 전화를 거절했습니다.
        </p>
      )}
      {(callStatus === "accepted" || callStatus === "ended") && (
        <>
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
          {callStatus === "accepted" && (
            <div className="mt-6 flex gap-4">
              <Button onClick={toggleCamera} disabled={ended}>
                {isCameraOn ? "카메라 끄기" : "카메라 켜기"}
              </Button>
              <Button variant="destructive" onClick={endCall} disabled={ended}>
                통화 종료
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
