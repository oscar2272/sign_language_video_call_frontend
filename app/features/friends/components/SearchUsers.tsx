import { useState, useEffect } from "react";
import { useSearchParams, useFetcher } from "react-router";
import { Pagination } from "../pages/friends-page";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";

const PAGE_SIZE = 5;

interface UserProfile {
  id: number;
  email: string;
  profile: {
    nickname: string;
    profile_image_url?: string | null;
  };
  is_friend: boolean;
  request_sent: boolean;
}
interface SearchUsersProps {
  userId: number;
}

export function SearchUsers({ userId }: SearchUsersProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get("page") || "1");

  // URL과 동기화된 검색어 상태
  const [query, setQuery] = useState(searchParams.get("q") || "");
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

  const fetcher = useFetcher<{ results: UserProfile[] }>();

  // 버튼별 로딩 상태
  const [loadingUserId, setLoadingUserId] = useState<number | null>(null);

  const onChangeQuery = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const onSearchClick = () => {
    const formData = new FormData();
    formData.append("q", query);
    formData.append("actionType", "search");
    fetcher.submit(formData, { method: "post" });
    setSearchParams({ q: query, page: "1" });
  };

  const onPageChange = (newPage: number) => {
    setSearchParams({ q: query, page: newPage.toString() });
  };

  const users = fetcher.data?.results || [];
  const maxPage = Math.ceil(users.length / PAGE_SIZE);
  const pageData = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // fetcher idle이면 버튼 로딩 초기화
  useEffect(() => {
    if (fetcher.state === "idle") {
      setLoadingUserId(null);
    }
  }, [fetcher.state]);

  const loadingSearch = fetcher.state !== "idle" && loadingUserId === null;

  return (
    <div>
      {/* 검색 입력 */}
      <div className="flex space-x-2 mb-4">
        <input
          type="text"
          placeholder="유저 닉네임 또는 이메일로 검색"
          className="flex-grow p-2 border rounded"
          value={query}
          onChange={onChangeQuery}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearchClick();
          }}
        />
        <Button onClick={onSearchClick} disabled={loadingSearch}>
          {loadingSearch ? "검색 중..." : "검색"}
        </Button>
      </div>

      {!loadingSearch && pageData.length === 0 && query !== "" && (
        <p className="text-center py-4">검색 결과가 없습니다.</p>
      )}

      {/* 검색 결과 */}
      {pageData.map((user) => {
        const isMe = user.id === userId;

        return (
          <div
            key={user.id}
            className="flex items-center justify-between border rounded p-3 mb-3"
          >
            <div className="flex items-center space-x-3 min-w-0">
              <Avatar className="w-12 h-12">
                {user.profile.profile_image_url ? (
                  <AvatarImage
                    src={user.profile.profile_image_url}
                    alt={user.profile.nickname || user.email}
                    className="object-cover"
                  />
                ) : (
                  <AvatarFallback className="text-2xl flex items-center justify-center bg-gray-300 rounded-full">
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

            {!isMe && (
              <fetcher.Form
                method="post"
                onSubmit={() => setLoadingUserId(user.id)}
              >
                <input type="hidden" name="requestId" value={user.id} />
                <input type="hidden" name="actionType" value="request" />
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    loadingUserId === user.id ||
                    user.is_friend ||
                    user.request_sent
                  }
                >
                  {user.is_friend
                    ? "친구"
                    : user.request_sent
                      ? "요청 완료"
                      : loadingUserId === user.id
                        ? "요청 중..."
                        : "친구 요청"}
                </Button>
              </fetcher.Form>
            )}
          </div>
        );
      })}

      {/* 페이지네이션 */}
      {maxPage > 1 && (
        <Pagination page={page} maxPage={maxPage} onPageChange={onPageChange} />
      )}
    </div>
  );
}
