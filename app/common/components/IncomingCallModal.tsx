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

  // 슬라이드 인 효과
  useEffect(() => {
    setVisible(true);
  }, []);

  // 타이머
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setVisible(false);
          onReject(); // 시간초과 시 자동 거절
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, onReject]);

  return (
    <div
      className={`fixed top-0 left-0 h-full w-80 bg-white shadow-lg border-r z-50 flex flex-col p-6
        transform transition-transform duration-300 ${
          visible ? "translate-x-0" : "-translate-x-full"
        }`}
    >
      <h2 className="text-lg font-semibold mb-2">
        📞 {call.from_user_name} 님의 전화
      </h2>
      <p className="text-sm text-gray-500 mb-4">시간 초: {timeLeft}초</p>
      <div className="flex gap-3 mt-auto">
        <Button
          onClick={() => {
            setVisible(false);
            onAccept();
          }}
          className="flex-1"
        >
          수락
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            setVisible(false);
            onReject();
          }}
          className="flex-1"
        >
          거절
        </Button>
      </div>
    </div>
  );
}
