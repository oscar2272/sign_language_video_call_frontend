// app/routes/call/$id?.tsx
import React, { useEffect, useRef } from "react";
import { Button } from "~/common/components/ui/button";
import type { Route } from "./+types/call-page";

export const loader = async ({ params }: Route.LoaderArgs) => {
  // id가 없으면 null 반환
  return { roomId: params.id || null };
};

export default function CallPage({ loaderData }: Route.ComponentProps) {
  const { roomId } = loaderData;
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!roomId) return; // roomId 없으면 카메라 접근 안함
    async function initLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("카메라/마이크 접근 실패:", err);
      }
    }
    initLocalStream();
  }, [roomId]);

  if (!roomId) {
    // roomId가 없으면 전화 준비 중 화면
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white">
        <h1 className="text-xl mb-4">전화 준비 중...</h1>
      </div>
    );
  }

  // roomId가 있으면 실제 통화 화면
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
        <Button variant="destructive">통화 종료</Button>
        <Button variant="secondary">음소거</Button>
        <Button variant="secondary">카메라 끄기</Button>
      </div>
    </div>
  );
}
