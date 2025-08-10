import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";
import { Pagination } from "../pages/friends-page";

const PAGE_SIZE = 3;

export function SearchUsers({
  users,
  onFriendRequest,
}: {
  users: UserProfile[];
  onFriendRequest: (userId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = users.filter(
    (user) =>
      user.profile?.nickname?.toLowerCase().includes(query.toLowerCase()) ||
      user.email.toLowerCase().includes(query.toLowerCase())
  );

  const maxPage = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <input
        type="text"
        placeholder="유저 닉네임 또는 이메일로 검색"
        className="w-full p-2 border rounded"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
      />
      {pageData.length === 0 && (
        <p className="text-center py-4">검색 결과가 없습니다.</p>
      )}
      {pageData.map((user) => (
        <div
          key={user.id}
          className="flex items-center justify-between border rounded p-3 mt-3"
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
                {user.profile?.nickname || "-"}
              </p>
              <p className="text-sm text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <Button size="sm" onClick={() => onFriendRequest(user.id)}>
            친구 요청
          </Button>
        </div>
      ))}
      {maxPage > 1 && (
        <Pagination page={page} maxPage={maxPage} onPageChange={setPage} />
      )}
    </div>
  );
}
