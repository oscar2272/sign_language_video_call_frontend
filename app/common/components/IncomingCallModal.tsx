import { Button } from "~/common/components/ui/button";
import type { IncomingCall } from "~/features/calls/type";

interface Props {
  call: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallModal({ call, onAccept, onReject }: Props) {
  return (
    <div className="fixed top-0 left-0 h-full w-80 bg-white shadow-lg border-r z-50 flex flex-col p-6">
      <h2 className="text-lg font-semibold mb-4">
        📞 {call.from_user_name} 님의 전화
      </h2>
      <div className="flex gap-3 mt-auto">
        <Button onClick={onAccept} className="flex-1">
          수락
        </Button>
        <Button variant="destructive" onClick={onReject} className="flex-1">
          거절
        </Button>
      </div>
    </div>
  );
}
