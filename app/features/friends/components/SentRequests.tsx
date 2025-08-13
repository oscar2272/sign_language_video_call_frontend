import { useState } from "react";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { Pagination } from "../pages/friends-page";
import { useFetcher } from "react-router";

const PAGE_SIZE = 10;

type SentList = {
  id: number;
  to_user: {
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
}: {
  sentList: SentList[];
  sentCount: number;
}) {
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(sentCount / PAGE_SIZE);
  const fetcher = useFetcher();

  const handleCancel = (id: number) => {
    if (fetcher.state !== "idle") return; // 중복 클릭 방지
    const formData = new FormData();
    formData.append("requestId", id.toString());
    formData.append("actionType", "cancel");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div>
      {sentCount === 0 ? (
        <p className="text-center py-4">보낸 친구 요청이 없습니다.</p>
      ) : (
        sentList.map((relation) => {
          const user = relation.to_user;

          const isLoading =
            fetcher.state !== "idle" &&
            fetcher.formData?.get("requestId") === relation.id.toString();

          return (
            <div
              key={relation.id}
              className="flex items-center justify-between border rounded p-3 mb-3"
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
                      {user.profile.nickname?.[0] || user.email[0]}
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
                onClick={() => handleCancel(relation.id)}
                disabled={isLoading}
              >
                {isLoading ? "로딩..." : "취소"}
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
