const BASE_URL = process.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const USER_API_URL = `${BASE_URL}/api/users`;

export async function EmailSignup(token: string): Promise<{ error?: string }> {
  const res = await fetch(`${USER_API_URL}/signup/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  //test
  if (!res.ok) {
    const errorData = await res.json();
    return { error: errorData.message || "회원가입 실패" };
  }
  return {};
}

export async function SocialLogin(token: string) {
  const res = await fetch(`${USER_API_URL}/social-signup/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const errorData = await res.json();
    console.error("SocialLogin failed:", errorData);
    throw new Error("User sync failed");
  }
}
