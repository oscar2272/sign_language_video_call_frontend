import { useState } from "react";
import { ReceivedRequests } from "../components/ReceivedRequest";
import { SentRequests } from "../components/SentRequests";
import { FriendsList } from "../components/FriendList";
import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/friends-page";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  deleteFriend,
  getFriends,
  getReceivedRequest,
  getSentRequest,
  rejectFriendRequest,
  requestFriend,
} from "../api";
import { redirect, useOutletContext } from "react-router";
import { searchUsers } from "~/features/profiles/profile-api";
import { SearchUsers } from "../components/SearchUsers";
import { callFriends } from "~/features/calls/api";
export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string | null;
  const requestId = formData.get("requestId")
    ? Number(formData.get("requestId"))
    : null;
  const searchQuery = formData.get("q") as string | null;
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) return redirect("/auth/signin");

  switch (actionType) {
    case "request":
      if (requestId) await requestFriend(token, requestId);
      break;
    case "accept":
      if (requestId) await acceptFriendRequest(token, requestId);
      break;
    case "reject":
      if (requestId) await rejectFriendRequest(token, requestId);
      break;
    case "cancel":
      if (requestId) await cancelFriendRequest(token, requestId);
      break;
    case "delete":
      if (requestId) await deleteFriend(token, requestId);
      break;
    case "search":
      if (searchQuery) {
        const users = await searchUsers(token, searchQuery);
        return { results: users }; // <-- 이렇게 wrapping
      }
    case "call":
      if (requestId) {
        const callJson = await callFriends(token, requestId);
        const roomId = callJson.room_id;

        return redirect(`/call/${roomId}`);
      }
  }

  return null;
};
export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return { globalError: "로그인이 필요합니다." };
  }
  const [sentRequests, friends, receivedRequests] = await Promise.all([
    getSentRequest(token),
    getFriends(token),
    getReceivedRequest(token),
  ]);
  const sentCount = sentRequests.count;
  const friendsCount = friends.count;
  const receivedCount = receivedRequests.count;
  return {
    sentRequests,
    receivedRequests,
    sentCount,
    receivedCount,
    friendsCount,
    friends,
  };
};

export default function FriendsPage({ loaderData }: Route.ComponentProps) {
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();
  const sentRequests = loaderData.sentRequests || [];
  const receivedRequests = loaderData.receivedRequests || [];
  const friendsList = loaderData.friends || [];
  const sentCount = loaderData.sentCount || 0;
  const receivedCount = loaderData.receivedCount || 0;
  const friendsCount = loaderData.friendsCount || 0;
  const tabs = [
    { label: "친구 목록", key: "friends", count: friendsCount },
    { label: "보낸 요청", key: "sent", count: sentCount },
    { label: "받은 요청", key: "received", count: receivedCount },
    { label: "유저 검색", key: "search" },
  ];

  const [activeTab, setActiveTab] = useState<
    "received" | "sent" | "friends" | "search"
  >("friends");

  return (
    <div className="px-15 mx-auto">
      <h1 className="text-2xl font-bold mb-4">연락처</h1>

      {/* 탭 메뉴 */}
      <div className="flex border-b mb-6 space-x-4 justify-start">
        {tabs.map(({ label, key, count }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`text-center px-3 py-1 text-sm -mb-px border-b-2 ${
              activeTab === key
                ? "border-blue-600 font-semibold"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {label} {count !== undefined ? `(${count})` : ""}
          </button>
        ))}
      </div>

      {/* 컨텐츠 영역 */}
      <div>
        {activeTab === "received" && (
          <ReceivedRequests
            receivedCount={receivedCount}
            receivedList={receivedRequests.results}
          />
        )}
        {activeTab === "sent" && (
          <SentRequests sentCount={sentCount} sentList={sentRequests.results} />
        )}
        {activeTab === "friends" && (
          <FriendsList
            friendsList={friendsList.results} // 친구 목록만 넘기기
            friendsCount={friendsCount}
          />
        )}
        {activeTab === "search" && <SearchUsers userId={user.id} />}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  maxPage,
  onPageChange,
}: {
  page: number;
  maxPage: number;
  onPageChange: (newPage: number) => void;
}) {
  return (
    <div className="flex justify-center mt-4 space-x-2">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="px-3 py-1 border rounded disabled:opacity-50"
      >
        이전
      </button>
      {[...Array(maxPage)].map((_, i) => {
        const p = i + 1;
        return (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-3 py-1 border rounded ${
              p === page ? "bg-blue-600 text-white" : "hover:bg-gray-100"
            }`}
          >
            {p}
          </button>
        );
      })}
      <button
        disabled={page >= maxPage}
        onClick={() => onPageChange(page + 1)}
        className="px-3 py-1 border rounded disabled:opacity-50"
      >
        다음
      </button>
    </div>
  );
}
