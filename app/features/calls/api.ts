const BASE_URL = process.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const CALL_API_URL = `${BASE_URL}/api/calls`;

export async function getCallHistoryList(token: string) {
  const res = await fetch(`${CALL_API_URL}/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}
