import { useState } from "react";

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<
    "received" | "sent" | "friends" | "search"
  >("received");

  return (
    <div className="px-10 mx-auto">
      <h1 className="text-2xl font-bold mb-4">Friend</h1>

      {/* 탭 메뉴 */}
      <div className="flex border-b mb-6">
        {["받은 요청", "보낸 요청", "친구 목록", "유저 검색"].map((tab) => {
          const key =
            tab === "받은 요청"
              ? "received"
              : tab === "보낸 요청"
                ? "sent"
                : tab === "친구 목록"
                  ? "friends"
                  : "search";
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`px-4 py-2 -mb-px border-b-2 ${
                activeTab === key
                  ? "border-primary font-semibold"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* 컨텐츠 영역 */}
      <div>
        {activeTab === "received" && <ReceivedRequests />}
        {activeTab === "sent" && <SentRequests />}
        {activeTab === "friends" && <FriendsList />}
        {activeTab === "search" && <SearchUsers />}
      </div>
    </div>
  );
}

// 각 컴포넌트 예시 (더미)
function ReceivedRequests() {
  return <div>받은 친구 요청 목록 (수락 / 거절 버튼 포함)</div>;
}
function SentRequests() {
  return <div>내가 보낸 친구 요청 목록 (취소 버튼 포함)</div>;
}
function FriendsList() {
  return <div>내 친구 목록 (프로필, 상태, 삭제 등)</div>;
}
function SearchUsers() {
  return (
    <div>
      <input
        type="text"
        placeholder="유저 닉네임 또는 이메일로 검색"
        className="w-full p-2 border rounded"
      />
      <div className="mt-4">검색 결과가 여기 표시됩니다.</div>
    </div>
  );
}
