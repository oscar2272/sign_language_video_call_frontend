import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { useState } from "react";
import { Pagination } from "../pages/friends-page";

const PAGE_SIZE = 10;

export function SentRequests({
  relations,
  onCancel,
}: {
  relations: FriendRelation[];
  onCancel: (id: number) => void;
}) {
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(relations.length / PAGE_SIZE);
  const pageData = relations.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {pageData.length === 0 ? (
        <p className="text-center py-4">보낸 친구 요청이 없습니다.</p>
      ) : (
        pageData.map((relation) => {
          const user = relation.to_user;

          return (
            <div
              key={relation.id}
              className="flex items-center justify-between border rounded p-3 mb-3"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Avatar className="w-12 h-12">
                  {user.profile?.profile_image_url ? (
                    <AvatarImage
                      src={user.profile.profile_image_url}
                      alt={user.profile.nickname || user.email}
                      className="object-cover"
                    />
                  ) : (
                    <AvatarFallback className="text-2xl">
                      {user.profile.nickname?.[0] || user.email[0]}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="truncate">
                  <p className="font-semibold truncate">
                    {user.profile.nickname || "-"}
                  </p>
                  <p className="text-sm text-gray-500 truncate">{user.email}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onCancel(relation.id)}
              >
                취소
              </Button>
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
