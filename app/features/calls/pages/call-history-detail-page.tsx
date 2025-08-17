import React from "react";
import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/call-history-detail-page";
import { getCallHistoryDetailList } from "../api";
import { Button } from "~/common/components/ui/button";
import { Phone, PhoneCall, PhoneOff, ArrowLeft, Trash2 } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Link } from "react-router";

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) return { globalError: "로그인이 필요합니다." };

  const callId = params.id;
  const history = await getCallHistoryDetailList(token, callId);
  return { history };
};

const getCallStatusInfo = (status: string, isOutgoing: boolean) => {
  switch (status) {
    case "ACCEPTED":
      return {
        icon: isOutgoing ? (
          <Phone className="w-6 h-6 text-green-500" />
        ) : (
          <PhoneCall className="w-6 h-6 text-blue-500" />
        ),
        text: isOutgoing ? "발신 통화" : "수신 통화",
        color: isOutgoing ? "text-green-500" : "text-blue-500",
      };
    case "REJECTED":
      return {
        icon: <PhoneOff className="w-6 h-6 text-red-500" />,
        text: "거절된 통화",
        color: "text-red-500",
      };
    case "MISSED":
      return {
        icon: <PhoneOff className="w-6 h-6 text-orange-500" />,
        text: "부재중 통화",
        color: "text-orange-500",
      };
    default:
      return {
        icon: <Phone className="w-6 h-6 text-gray-400" />,
        text: "알 수 없음",
        color: "text-gray-400",
      };
  }
};

export default function CallHistoryDetailPage({
  loaderData,
}: Route.ComponentProps) {
  const history = loaderData.history;
  const isOutgoing = history.direction === "OUTGOING";
  const statusInfo = getCallStatusInfo(history.call_status, isOutgoing);

  const callDate = new Date(history.called_at);
  const formattedDate = callDate.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const formattedTime = callDate.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  let duration = "연결되지 않음";
  if (history.started_at && history.ended_at) {
    const diffSec = Math.floor(
      (new Date(history.ended_at).getTime() -
        new Date(history.started_at).getTime()) /
        1000
    );
    const hours = Math.floor(diffSec / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    const seconds = diffSec % 60;
    duration =
      hours > 0
        ? `${hours}시간 ${minutes}분 ${seconds}초`
        : minutes > 0
          ? `${minutes}분 ${seconds}초`
          : `${seconds}초`;
  }

  const displayUser = isOutgoing ? history.receiver : history.caller;

  return (
    <div className="min-h-screen">
      {/* 헤더 */}
      <header className="py-6 sticky top-0 z-10">
        <div className="w-full px-6 md:px-10 lg:px-20 flex items-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/call-history">
              <ArrowLeft className="w-6 h-6" />
            </Link>
          </Button>
          <h1 className="ml-4 text-2xl font-semibold">통화 상세</h1>
        </div>
      </header>

      <main className="w-full px-6 md:px-10 lg:px-20 py-8 space-y-8">
        {/* 프로필 영역 */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
          <Avatar className="w-24 h-24">
            {displayUser.profile_image_url ? (
              <AvatarImage
                src={displayUser.profile_image_url}
                alt={displayUser.nickname}
              />
            ) : (
              <AvatarFallback className="text-3xl font-bold">
                {displayUser.nickname?.[0]}
              </AvatarFallback>
            )}
          </Avatar>

          <div className="flex-1 w-full">
            <h2 className="text-3xl font-medium">{displayUser.nickname}</h2>
            <div className="flex items-center mt-3 space-x-3">
              {statusInfo.icon}
              <span className={`font-medium ${statusInfo.color}`}>
                {statusInfo.text}
              </span>
            </div>

            {/* 통화 정보 */}
            <div className="mt-6 grid grid-cols-2 gap-6 md:gap-8">
              <div className="flex flex-col">
                <span className="text-sm">날짜</span>
                <span className="font-medium">{formattedDate}</span>
                <span className="text-sm">{formattedTime}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm">통화 시간</span>
                <span className="font-medium">{duration}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm">유형</span>
                <span className="font-medium">
                  {isOutgoing ? "발신" : "수신"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          <Button className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center rounded-lg transition">
            <Phone className="w-5 h-5 mr-2" /> 다시 전화하기
          </Button>

          <Button
            variant="destructive"
            className="w-full py-4 flex justify-center items-center rounded-lg transition"
          >
            <Trash2 className="w-5 h-5 mr-2" /> 통화 기록 삭제
          </Button>
        </div>
      </main>
    </div>
  );
}
