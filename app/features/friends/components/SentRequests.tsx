import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { useState } from "react";
import { Pagination } from "../pages/friends-page";

const PAGE_SIZE = 10;
type SentList = {
  from_user: {
    id: number;
    email: string;
    profile: {
      nickname: string;
      profile_image_url: string | null;
    };
  };
};
export function SentRequests({
  sentList,
  sentCount,
  onCancel,
}: {
  sentList: SentList[];
  sentCount: number;
  onCancel: (id: number) => void;
}) {
  console.log("SentRequests sentList:", sentList);
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(sentCount / PAGE_SIZE);

  return (
    <div>
      {sentCount === 0 ? (
        <p className="text-center py-4">보낸 친구 요청이 없습니다.</p>
      ) : (
        sentList.map((relation: any) => {
          const user = relation.to_user;

          return (
            <div
              key={relation.id}
              className="flex items-center justify-between border rounded p-3 mb-3 "
            >
              <div className="flex items-center space-x-3 min-w-0">
                <Avatar className="w-12 h-12">
                  {user.profile.profile_image_url ? (
                    <AvatarImage
                      src={user.profile.profile_image_url}
                      alt={user.profile.nickname}
                      className="object-cover"
                    />
                  ) : (
                    <AvatarFallback className="text-2xl">
                      {user.profile.nickname?.[0]}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="truncate">
                  <p className="font-semibold truncate">
                    {user.profile.nickname}
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
