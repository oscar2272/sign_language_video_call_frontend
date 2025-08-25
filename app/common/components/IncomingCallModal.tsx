import { Button } from "~/common/components/ui/button";
import { useEffect, useState } from "react";
import type { IncomingCall } from "~/features/calls/type";

interface Props {
  call: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
  duration?: number; // 자동 닫기 시간 (ms)
}

export default function IncomingCallModal({
  call,
  onAccept,
  onReject,
  duration = 30000, // 기본 30초
}: Props) {
  const [visible, setVisible] = useState(false);
  const [timeLeft, setTimeLeft] = useState(duration / 1000);

  // 슬라이드 인
  useEffect(() => setVisible(true), []);

  // 타이머
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setVisible(false);
          onReject();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, onReject]);

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
        <Button
          onClick={() => {
            setVisible(false);
            onAccept();
          }}
          className="flex-1 py-1 text-sm"
        >
          수락
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setVisible(false);
            onReject();
          }}
          className="flex-1 py-1 text-sm"
        >
          거절
        </Button>
      </div>
    </div>
  );
}
