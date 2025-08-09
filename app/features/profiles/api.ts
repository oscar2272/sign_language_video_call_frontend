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
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error("Failed to update profile");
  }
  return res.status;
}
