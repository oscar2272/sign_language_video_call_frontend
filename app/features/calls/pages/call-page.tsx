import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router";
import type { UserProfile } from "~/features/profiles/type";
import type { Route } from "./+types/call-page";
import { Button } from "~/common/components/ui/button";

const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;
export const loader = async ({ params }: Route.LoaderArgs) => {
  return { roomId: params.id || null };
};
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
    "calling" | "accepted" | "rejected" | "ended"
  >("calling");

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  // ========================
  // WebSocket 연결
  // ========================
  useEffect(() => {
    if (!roomId) return;

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${roomId}/?user_id=${user.id}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("WebSocket connected");
    ws.onclose = () => console.log("WebSocket disconnected");

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "call_request":
        case "offer":
          await handleOffer(data);
          break;
        case "answer":
          await handleAnswer(data);
          break;
        case "ice":
          if (data.candidate && pcRef.current) {
            await pcRef.current.addIceCandidate(
              new RTCIceCandidate(data.candidate)
            );
          }
          break;
        case "end_call":
          setCallStatus("ended");
          closeConnection();
          break;
        case "rejected":
          setCallStatus("rejected");
          alert("상대방이 통화를 거절했습니다.");
          navigate(-1);
          break;
      }
    };

    return () => ws.close();
  }, [roomId]);

  // ========================
  // WebRTC 초기화
  // ========================
  const initConnection = async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // 로컬 스트림
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    setLocalStream(stream);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    // 원격 스트림
    const remote = new MediaStream();
    setRemoteStream(remote);
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remote;

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => remote.addTrack(track));
    };

    // ICE candidate 전송
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(
          JSON.stringify({ type: "ice", candidate: event.candidate })
        );
      }
    };
  };

  // ========================
  // Offer 처리
  // ========================
  const handleOffer = async (data: any) => {
    if (!pcRef.current) await initConnection();

    await pcRef.current!.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );
    const answer = await pcRef.current!.createAnswer();
    await pcRef.current!.setLocalDescription(answer);

    wsRef.current?.send(JSON.stringify({ type: "answer", answer }));
  };

  // ========================
  // Answer 처리
  // ========================
  const handleAnswer = async (data: any) => {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
    }
  };

  // ========================
  // 수락 버튼
  // ========================
  const handleAccept = async () => {
    setCallStatus("accepted");
    await initConnection();

    wsRef.current?.send(JSON.stringify({ type: "accepted" }));
  };

  // ========================
  // 거절 버튼
  // ========================
  const handleReject = () => {
    wsRef.current?.send(JSON.stringify({ type: "rejected" }));
    setCallStatus("rejected");
    navigate(-1);
  };

  // ========================
  // 연결 종료
  // ========================
  const closeConnection = () => {
    localStream?.getTracks().forEach((t) => t.stop());
    remoteStream?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
  };

  // ========================
  // UI
  // ========================
  if (callStatus === "calling") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h2>📞 전화가 걸려왔습니다.</h2>
        <div className="flex gap-2">
          <Button onClick={handleAccept}>수락</Button>
          <Button onClick={handleReject} variant="destructive">
            거절
          </Button>
        </div>
      </div>
    );
  }

  if (callStatus === "accepted") {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <div className="flex gap-2">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            className="w-48 h-36 bg-black"
          />
          <video ref={remoteVideoRef} autoPlay className="w-48 h-36 bg-black" />
        </div>
        <Button
          variant="destructive"
          onClick={() => {
            wsRef.current?.send(JSON.stringify({ type: "end_call" }));
            setCallStatus("ended");
            closeConnection();
            navigate(-1);
          }}
        >
          통화 종료
        </Button>
      </div>
    );
  }

  if (callStatus === "ended" || callStatus === "rejected") {
    return <h2 className="text-center mt-20">통화가 종료되었습니다.</h2>;
  }

  return null;
}
