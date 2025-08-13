import React from "react";
import { Phone, PhoneCall, Clock } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";

export default function CallHistoryPage() {
  // 샘플 데이터 - 실제로는 props나 상태로 받아올 예정
  const callHistory = [
    {
      id: 1,
      user: {
        profile: {
          nickname: "영희",
          profile_image_url: null,
        },
        email: "younghee@example.com",
      },
      callTime: "오후 2:16",
      callType: "outgoing", // incoming, outgoing, missed
      duration: "5분 23초",
    },
    {
      id: 2,
      user: {
        profile: {
          nickname: "영희",
          profile_image_url: null,
        },
        email: "younghee@example.com",
      },
      callTime: "어제",
      callType: "incoming",
      duration: "12분 45초",
    },
    {
      id: 3,
      user: {
        profile: {
          nickname: "영희",
          profile_image_url: null,
        },
        email: "younghee@example.com",
      },
      callTime: "월요일",
      callType: "missed",
      duration: "부재중",
    },
  ];

  const getCallIcon = (callType: any) => {
    switch (callType) {
      case "outgoing":
        return <Phone className="w-4 h-4 text-green-600" />;
      case "incoming":
        return <PhoneCall className="w-4 h-4 text-blue-600" />;
      case "missed":
        return <Phone className="w-4 h-4 text-red-600" />;
      default:
        return <Phone className="w-4 h-4 text-gray-500" />;
    }
  };

  const getCallTypeText = (callType: any) => {
    switch (callType) {
      case "outgoing":
        return "발신";
      case "incoming":
        return "수신";
      case "missed":
        return "부재중";
      default:
        return "";
    }
  };

  return (
    <div className="px-15 mx-auto">
      <h1 className="text-2xl font-semibold mb-6">통화 기록</h1>

      {callHistory.length > 0 ? (
        <div className="space-y-3 ">
          {callHistory.map((call) => (
            <div
              key={call.id}
              className="flex items-center bg-white justify-between border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="flex items-center space-x-3 min-w-0 flex-1">
                <Avatar className="w-12 h-12">
                  {call.user.profile.profile_image_url ? (
                    <AvatarImage
                      src={call.user.profile.profile_image_url}
                      alt={call.user.profile.nickname}
                      className="object-cover"
                    />
                  ) : (
                    <AvatarFallback>
                      {call.user.profile.nickname?.[0]}
                    </AvatarFallback>
                  )}
                </Avatar>

                <div className="truncate flex-1">
                  <div className="flex items-center space-x-2">
                    <p className="font-semibold truncate">
                      {call.user.profile.nickname}
                    </p>
                    {getCallIcon(call.callType)}
                  </div>
                  <p className="text-sm text-gray-500 truncate">
                    {call.user.email}
                  </p>
                  <div className="flex items-center space-x-2 text-xs text-gray-400 mt-1">
                    <Clock className="w-3 h-3" />
                    <span>{call.duration}</span>
                  </div>
                </div>
              </div>

              <div className="text-right ml-4">
                <p className="text-sm text-gray-600 mb-1">{call.callTime}</p>
                <p className="text-xs text-gray-400">
                  {getCallTypeText(call.callType)}
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="ml-3 p-2"
                onClick={() =>
                  console.log("통화하기:", call.user.profile.nickname)
                }
              >
                <Phone className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <Phone className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg mb-2">통화 기록이 없습니다</p>
          <p className="text-gray-400 text-sm">첫 통화를 시작해보세요</p>
        </div>
      )}
    </div>
  );
}
