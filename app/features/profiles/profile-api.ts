// app/features/profiles/api.ts
const BASE_URL = process.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const USER_API_URL = `${BASE_URL}/api/users`;

export async function getUserProfile(token: string) {
  const res = await fetch(`${USER_API_URL}/me/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch profile");
  }
  return res.json();
}

export async function updateUserProfile(
  token: string,
  avatar: File | null,
  name: string
) {
  const formData = new FormData();
  if (avatar) {
    formData.append("profile_image_url", avatar);
  }
  formData.append("nickname", name);

  const res = await fetch(`${USER_API_URL}/me/`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      // 'Content-Type' 헤더는 FormData일 때 자동 설정됨. 안 넣어도 됨.
    },
    body: formData,
  });

  if (!res.ok) {
    // 에러 응답의 JSON 본문 읽기 시도
    const errorData = await res.json().catch(() => null);
    if (errorData) {
      // 예: { nickname: ["이미 사용 중인 닉네임입니다."] } 이런 구조 예상
      // 구체적인 에러 메시지를 에러로 던지기
      const firstKey = Object.keys(errorData)[0];
      const firstError = Array.isArray(errorData[firstKey])
        ? errorData[firstKey][0]
        : errorData[firstKey];
      throw new Error(firstError || "Failed to update profile");
    }
    throw new Error("Failed to update profile");
  }

  return res.status;
}
