import { useState } from "react";
import { ReceivedRequests } from "../components/ReceivedRequest";
import { SentRequests } from "../components/SentRequests";
import { FriendsList } from "../components/FriendList";
import { SearchUsers } from "../components/SearchUsers";
import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/friends-page";
import { getFriends, getReceivedRequest, getSentRequest } from "../api";

// 임시 데이터 예시
const dummyUsers: UserProfile[] = [
  {
    id: 1,
    email: "chulsoo@example.com",
    profile: {
      nickname: "철수",
      profile_image_url: null,
    },
  },
  {
    id: 2,
    email: "younghee@example.com",
    profile: {
      nickname: "영희",
      profile_image_url: "https://randomuser.me/api/portraits/women/68.jpg",
    },
  },
  {
    id: 3,
    email: "minsu@example.com",
    profile: {
      nickname: "민수",
      profile_image_url: null,
    },
  },
  {
    id: 4,
    email: "sujin@example.com",
    profile: {
      nickname: "수진",
      profile_image_url: "https://randomuser.me/api/portraits/women/10.jpg",
    },
  },
  {
    id: 5,
    email: "jaehyun@example.com",
    profile: {
      nickname: "재현",
      profile_image_url: "https://randomuser.me/api/portraits/men/20.jpg",
    },
  },
  {
    id: 6,
    email: "dahyun@example.com",
    profile: {
      nickname: "다현",
      profile_image_url: null,
    },
  },
];

// 임시 친구 요청 데이터
const dummyFriendRelations: FriendRelation[] = [
  {
    id: 1,
    from_user: dummyUsers[0],
    to_user: dummyUsers[1],
    status: "PENDING",
  },
  {
    id: 2,
    from_user: dummyUsers[2],
    to_user: dummyUsers[0],
    status: "PENDING",
  },
  {
    id: 3,
    from_user: dummyUsers[0],
    to_user: dummyUsers[3],
    status: "ACCEPTED",
  },
  {
    id: 4,
    from_user: dummyUsers[4],
    to_user: dummyUsers[0],
    status: "ACCEPTED",
  },
  {
    id: 5,
    from_user: dummyUsers[0],
    to_user: dummyUsers[5],
    status: "REJECTED",
  },
];
export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return { globalError: "로그인이 필요합니다." };
  }
  const sentRequests = await getSentRequest(token);
  const sentCount = sentRequests.count;
  const friends = await getFriends(token);
  const friendsCount = friends.count;
  const receivedRequests = await getReceivedRequest(token);
  const receivedCount = receivedRequests.count;
  //console.log("friends", friends);

  return {
    sentRequests,
    receivedRequests,
    sentCount,
    receivedCount,
    friendsCount,
  };
};

export default function FriendsPage({ loaderData }: Route.ComponentProps) {
  const sentRequests = loaderData.sentRequests || [];
  const receivedRequests = loaderData.receivedRequests || [];
  const sentCount = loaderData.sentCount || 0;
  const receivedCount = loaderData.receivedCount || 0;
  const friendsCount = loaderData.friendsCount || 0;
  const currentUserId = 1;
  const tabs = [
    { label: "친구 목록", key: "friends", count: friendsCount },
    { label: "보낸 요청", key: "sent", count: sentCount },
    { label: "받은 요청", key: "received", count: receivedCount },
    { label: "유저 검색", key: "search" },
  ];

  const [activeTab, setActiveTab] = useState<
    "received" | "sent" | "friends" | "search"
  >("received");
  // const receivedRelations = dummyFriendRelations.filter(
  //   (rel) => rel.to_user.id === currentUserId && rel.status === "PENDING"
  // );

  // const sentRelations = dummyFriendRelations.filter(
  //   (rel) => rel.from_user.id === currentUserId && rel.status === "PENDING"
  // );

  // 친구 목록 (ACCEPTED)
  const friendsRelations = dummyFriendRelations.filter(
    (rel) =>
      rel.status === "ACCEPTED" &&
      (rel.from_user.id === currentUserId || rel.to_user.id === currentUserId)
  );
  return (
    <div className="px-10 mx-auto">
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
            onAccept={() => {}}
            onReject={() => {}}
          />
        )}
        {activeTab === "sent" && (
          <SentRequests
            sentCount={sentCount}
            sentList={sentRequests.results}
            onCancel={() => {}}
          />
        )}
        {activeTab === "friends" && (
          <FriendsList
            relations={friendsRelations} // 친구 목록만 넘기기
            currentUserId={currentUserId}
            onDelete={() => {}}
            onCall={() => {}}
          />
        )}
        {activeTab === "search" && (
          <SearchUsers onFriendRequest={(id) => console.log("친구 요청", id)} />
        )}
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
