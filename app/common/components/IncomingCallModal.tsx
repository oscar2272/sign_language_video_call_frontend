import { useState, useEffect } from "react";
import { Button } from "~/common/components/ui/button";
import type { IncomingCall } from "~/features/calls/type";
import { acceptCall, missCall, rejectCall } from "~/features/calls/api";
import { useNavigate } from "react-router";

interface Props {
  call: IncomingCall;
  token: string;
  duration?: number; // 자동 닫기 시간(ms)
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallModal({
  call,
  token,
  duration = 30000,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState(duration / 1000);
  const navigate = useNavigate();

  useEffect(() => setVisible(true), []);

  // 30초 타이머
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setVisible(false);

          // 시간초과 → 부재중 기록
          missCall(token, call.room_id, call.from_user_id).catch(console.error);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, token, call]);

  const handleAccept = async () => {
    try {
      await acceptCall(token, call.room_id, call.from_user_id);
      setVisible(false);
      navigate(`/call/${call.room_id}`); // 수락 후 CallPage로 이동
    } catch (err) {
      console.error("수락 기록 실패:", err);
    }
  };

  const handleReject = async () => {
    try {
      await rejectCall(token, call.room_id, call.from_user_id);
      setVisible(false);
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
