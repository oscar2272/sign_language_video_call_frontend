// app/features/profiles/subscription-api.ts
const BASE_URL = import.meta.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const SUBSCRIPTION_API_URL = `${BASE_URL}/api/subscriptions`;

//subscription 데이터타입
// const subscription = await sw.pushManager.subscribe({
//   userVisibleOnly: true,
//   applicationServerKey: "<VAPID_PUBLIC_KEY_BASE64>", // 생성한 공개키
// });

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

export async function subscribePush(token: string, subscription: any) {
  const res = await fetch(`${SUBSCRIPTION_API_URL}/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscription }),
  });
  if (!res.ok) {
    throw new Error("Failed to fetch profile");
  }
  return res.json();
}
