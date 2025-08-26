import { useState, useEffect, useRef } from "react";
import { Button } from "~/common/components/ui/button";
import type { IncomingCall } from "~/features/calls/type";
import { useNavigate } from "react-router";
const BASE_URL = import.meta.env.VITE_API_BASE_URL;
const CALL_API_URL = `${BASE_URL}/api/calls`;
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ?? `ws://${window.location.hostname}:8000`;

interface Props {
  call: IncomingCall;
  token: string;
  duration?: number; // 자동 닫기 시간(ms)
  onAccept?: () => void; // optional
  onReject?: () => void; // optional
}

export default function IncomingCallModal({
  call,
  token,
  duration = 30000,
  onAccept,
  onReject,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState(duration / 1000);
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);

  // 1️⃣ 모달 열기 + WS 연결
  useEffect(() => {
    setVisible(true);

    const ws = new WebSocket(
      `${WS_BASE_URL}/ws/call/${call.room_id}/?user_id=${call.from_user_id}`
    );
    wsRef.current = ws;

    ws.onopen = () => console.log("✅ IncomingCall WS connected");

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "rejected") {
        // 상대방이 전화를 거절했을 때
        alert("상대방이 전화를 거절했습니다.");
        setVisible(false);
        onReject?.();
      }
      if (msg.type === "accepted") {
        // 상대방이 전화를 수락했을 때 (내가 걸었을 경우)
        navigate(`/call/${call.room_id}`);
      }
    };

    ws.onclose = () => console.log("❌ IncomingCall WS disconnected");

    return () => ws.close();
  }, [call.room_id, call.from_user_id, navigate, onReject]);

  // 2️⃣ 타이머
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);

    if (timeLeft <= 1) {
      clearInterval(interval);
      handleReject(); // 자동 거절
    }

    return () => clearInterval(interval);
  }, [visible, timeLeft]);

  // 3️⃣ 수락
  const handleAccept = async () => {
    try {
      await fetch(`${CALL_API_URL}/accept/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: call.room_id,
          caller_id: call.from_user_id,
        }),
      });

      wsRef.current?.send(JSON.stringify({ type: "accepted" }));

      setVisible(false);
      if (onAccept) onAccept();
      else navigate(`/call/${call.room_id}`);
    } catch (err) {
      console.error("수락 기록 실패:", err);
    }
  };

  // 4️⃣ 거절
  const handleReject = async () => {
    try {
      await fetch(`${CALL_API_URL}/reject/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: call.room_id,
          caller_id: call.from_user_id,
        }),
      });

      wsRef.current?.send(JSON.stringify({ type: "rejected" }));

      setVisible(false);
      onReject?.();
    } catch (err) {
      console.error("거절 기록 실패:", err);
    }
  };

  return (
    <div
      className={`fixed top-20 left-4 w-64 bg-white/90 backdrop-blur-sm shadow-lg rounded-xl border border-gray-200 z-50 flex flex-col p-4
        transform transition-transform duration-300 ${
          visible ? "translate-x-0" : "-translate-x-full"
        }`}
    >
      <h2 className="text-md font-semibold mb-1 truncate">
        📞 {call.from_user_name} 님의 전화
      </h2>
      <p className="text-xs text-gray-500 mb-3">시간 초: {timeLeft}초</p>

      <div className="flex gap-2 mt-auto">
        <Button onClick={handleAccept} className="flex-1 py-1 text-sm">
          수락
        </Button>
        <Button
          onClick={handleReject}
          variant="destructive"
          className="flex-1 py-1 text-sm"
        >
          거절
        </Button>
      </div>
    </div>
  );
}
