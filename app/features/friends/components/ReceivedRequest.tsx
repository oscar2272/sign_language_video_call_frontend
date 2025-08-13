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

type ReceivedList = {
  id: number;
  from_user: {
    id: number;
    email: string;
    profile: {
      nickname: string;
      profile_image_url: string | null;
    };
  };
};

export function ReceivedRequests({
  receivedList,
  receivedCount,
}: {
  receivedList: ReceivedList[];
  receivedCount: number;
}) {
  const [page, setPage] = useState(1);
  const maxPage = Math.ceil(receivedCount / PAGE_SIZE);
  const fetcher = useFetcher();

  const handleAction = (id: number, actionType: "accept" | "reject") => {
    if (fetcher.state !== "idle") return; // 중복 클릭 방지
    const formData = new FormData();
    formData.append("requestId", id.toString());
    formData.append("actionType", actionType);
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div>
      {receivedCount === 0 ? (
        <p className="text-center py-4">받은 친구 요청이 없습니다.</p>
      ) : (
        receivedList.map((relation) => {
          const user = relation.from_user;

          // 현재 이 버튼이 로딩 중인지 체크
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
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAction(relation.id, "accept")}
                  disabled={isLoading}
                >
                  {isLoading && fetcher.formData?.get("actionType") === "accept"
                    ? "로딩..."
                    : "수락"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleAction(relation.id, "reject")}
                  disabled={isLoading}
                >
                  {isLoading && fetcher.formData?.get("actionType") === "reject"
                    ? "로딩..."
                    : "거절"}
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
