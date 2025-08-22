import { Button } from "~/common/components/ui/button";
type IncomingCall = {
  from_user: string;
  room_id: string;
};

interface Props {
  call: IncomingCall;
  onAccept: () => void;
  onReject: () => void;
}

export default function IncomingCallModal({ call, onAccept, onReject }: Props) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-black/70 text-white z-50">
      <h2 className="text-xl mb-4">전화가 왔습니다: {call.from_user}</h2>
      <div className="flex gap-4">
        <Button onClick={onAccept}>수락</Button>
        <Button variant="destructive" onClick={onReject}>
          거절
        </Button>
      </div>
    </div>
  );
}
