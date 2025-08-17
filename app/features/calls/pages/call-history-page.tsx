import React, { useState } from "react";
import { Phone, PhoneCall, Clock, Info, InfoIcon } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { getCallHistoryList } from "../api";
import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/call-history-page";
import { Link, useOutletContext } from "react-router";
import { Pagination } from "~/features/friends/pages/friends-page";
export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return { globalError: "로그인이 필요합니다." };
  }
  const callHistory = await getCallHistoryList(token);
  console.log(callHistory);
  return { callHistory };
};
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

const getCallTypeText = (callType: any, callStatus: string) => {
  if (callStatus === "REJECTED") return "거절됨";
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
const PAGE_SIZE = 10;

export default function CallHistoryPage({
  loaderData,
}: {
  loaderData: CallHistoryLoaderData;
}) {
  const { user } = useOutletContext<{ user: UserProfile }>();
  const [page, setPage] = useState(1);

  const callHistoryList = loaderData?.callHistory?.results || [];
  const callHistoryCount =
    loaderData?.callHistory?.count || callHistoryList.length;
  const maxPage = Math.ceil(callHistoryCount / PAGE_SIZE);

  // 현재 페이지 데이터만 slice
  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const currentPageList = callHistoryList.slice(startIdx, endIdx);

  const formattedHistory = currentPageList.map((c: any) => {
    const myUserId = user.id;
    const otherUser = c.caller.id === myUserId ? c.receiver : c.caller;

    // 통화 타입 결정
    let callType: "outgoing" | "incoming" | "missed" = "missed";
    if (c.call_status === "ACCEPTED") {
      callType = c.caller.id === myUserId ? "outgoing" : "incoming";
    } else if (c.call_status === "MISSED") {
      callType = "missed";
    } else if (c.call_status === "REJECTED") {
      callType = "missed"; // 아이콘은 부재중과 동일
    }

    // 통화 시간/상태 표시
    let duration = "부재중";
    if (c.call_status === "REJECTED") {
      duration = "거절됨";
    } else if (c.started_at && c.ended_at) {
      const diffSec = Math.floor(
        (new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) /
          1000
      );
      const min = Math.floor(diffSec / 60);
      const sec = diffSec % 60;
      duration = `${min}분 ${sec}초`;
    }

    const callTime = new Date(c.called_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      id: c.id,
      user: {
        profile: {
          nickname: otherUser.nickname,
          profile_image_url: otherUser.profile_image_url || null,
        },
        email: otherUser.email || "",
      },
      callTime,
      callType,
      callStatus: c.call_status, // 추가
      duration,
    };
  });

  return (
    <div className="px-15 mx-auto">
      <h1 className="text-2xl font-semibold mb-6">통화 기록</h1>

      {formattedHistory.length > 0 ? (
        <>
          <div className="space-y-3">
            {formattedHistory.map((call) => (
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
                    {getCallTypeText(call.callType, call.callStatus)}
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
                  <Link to={`/call-history/${call.id}`}>
                    <InfoIcon className="w-4 h-4 text-blue-500" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
          {maxPage > 1 && (
            <Pagination page={page} maxPage={maxPage} onPageChange={setPage} />
          )}
        </>
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
