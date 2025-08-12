import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { Pagination } from "../pages/friends-page";

const PAGE_SIZE = 3;

export function FriendsList({
  relations,
  currentUserId,
  onDelete,
  onCall,
}: {
  relations: FriendRelation[];
  currentUserId: number;
  onDelete: (id: number) => void;
  onCall: (id: number) => void;
}) {
  const [page, setPage] = useState(1);

  // 친구 목록에서 내 친구만 필터링 (ACCEPTED 상태)
  const friends = relations.filter(
    (rel) =>
      rel.status === "ACCEPTED" &&
      (rel.from_user.id === currentUserId || rel.to_user.id === currentUserId)
  );

  const maxPage = Math.ceil(friends.length / PAGE_SIZE);
  const pageData = friends.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {pageData.length === 0 ? (
        <p className="text-center py-4">친구가 없습니다.</p>
      ) : (
        pageData.map((rel) => {
          // 상대방 유저 정보
          const friend: UserProfile =
            rel.from_user.id === currentUserId ? rel.to_user : rel.from_user;

          return (
            <div
              key={rel.id}
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
              <div className="flex space-x-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onCall(rel.id)}
                >
                  통화
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(rel.id)}
                >
                  삭제
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
