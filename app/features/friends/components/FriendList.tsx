import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { Pagination } from "../pages/friends-page";
import { useFetcher } from "react-router";

const PAGE_SIZE = 10;

type FriendList = {
  id: number;
  email: string;
  profile: {
    nickname: string;
    profile_image_url: string | null;
  };
};

export function FriendsList({
  friendsList,
  friendsCount,
}: {
  friendsList: FriendList[];
  friendsCount: number;
}) {
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(friendsCount / PAGE_SIZE);
  const fetcher = useFetcher();

  const handleDelete = (id: number) => {
    if (fetcher.state !== "idle") return; // 중복 클릭 방지
    const formData = new FormData();
    formData.append("requestId", id.toString());
    formData.append("actionType", "delete");
    fetcher.submit(formData, { method: "post" });
  };

  const handleCall = (id: number) => {
    const formData = new FormData();
    formData.append("requestId", id.toString());
    formData.append("actionType", "call");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div>
      {friendsCount === 0 ? (
        <p className="text-center py-4">친구가 없습니다.</p>
      ) : (
        friendsList.map((friend) => {
          const isLoading =
            fetcher.state !== "idle" &&
            fetcher.formData?.get("requestId") === friend.id.toString();

          return (
            <div
              key={friend.id}
              className="flex items-center justify-between border rounded p-3 mb-3"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Avatar className="w-12 h-12">
                  {friend.profile?.profile_image_url ? (
                    <AvatarImage
                      src={friend.profile.profile_image_url}
                      alt={friend.profile.nickname || friend.email}
                      className="object-cover"
                    />
                  ) : (
                    <AvatarFallback className="text-2xl">
                      {friend.profile.nickname?.[0] || friend.email[0]}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="truncate">
                  <p className="font-semibold truncate">
                    {friend.profile?.nickname || "-"}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    {friend.email}
                  </p>
                </div>
              </div>
              <div className="space-x-2">
                <Button
                  size="sm"
                  onClick={() => handleCall(friend.id)}
                  disabled={isLoading}
                >
                  {isLoading ? "로딩..." : "통화"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(friend.id)}
                  disabled={isLoading}
                >
                  {isLoading ? "로딩..." : "삭제"}
                </Button>
              </div>
            </div>
          );
        })
      )}
      {maxPage > 1 && (
        <Pagination page={page} maxPage={maxPage} onPageChange={setPage} />
      )}
    </div>
  );
}
