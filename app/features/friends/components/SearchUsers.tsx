import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Pagination } from "../pages/friends-page";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { Button } from "~/common/components/ui/button";

const PAGE_SIZE = 5; // 한 페이지에 보여줄 유저 수
const BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface UserProfile {
  id: number;
  email: string;
  profile: {
    nickname: string;
    profile_image_url?: string | null;
  };
}

export function SearchUsers({
  onFriendRequest,
}: {
  onFriendRequest: (userId: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearchTerm = searchParams.get("q") || "";
  const initialPage = Number(searchParams.get("page") || "1");

  const [query, setQuery] = useState(initialSearchTerm);
  const searchTerm = searchParams.get("q") || "";
  const page = Number(searchParams.get("page") || "1");

  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);

  // 백엔드에서 한 번에 전체 검색 결과를 받는다고 가정
  useEffect(() => {
    if (searchTerm.trim() === "") {
      setAllUsers([]);
      return;
    }
    setLoading(true);
    fetch(`${BASE_URL}/api/users/search?q=${encodeURIComponent(searchTerm)}`)
      .then((res) => res.json())
      .then((data: UserProfile[]) => {
        setAllUsers(data ?? []);
      })
      .finally(() => setLoading(false));
  }, [searchTerm]);

  // 페이지별로 보여줄 데이터 슬라이스
  const maxPage = Math.ceil(allUsers.length / PAGE_SIZE);
  const pageData = allUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const onChangeQuery = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const onSearchClick = () => {
    setSearchParams({ q: query, page: "1" });
  };

  const onPageChange = (newPage: number) => {
    setSearchParams({ q: searchTerm, page: newPage.toString() });
  };

  return (
    <div>
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
        <Button onClick={onSearchClick}>검색</Button>
      </div>

      {/*loading && <p>검색 중...</p>*/}

      {!loading && pageData.length === 0 && searchTerm !== "" && (
        <p className="text-center py-4">검색 결과가 없습니다.</p>
      )}

      {pageData.map((user) => (
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
          <Button size="sm" onClick={() => onFriendRequest(user.id)}>
            친구 요청
          </Button>
        </div>
      ))}

      {maxPage > 1 && (
        <Pagination page={page} maxPage={maxPage} onPageChange={onPageChange} />
      )}
    </div>
  );
}
