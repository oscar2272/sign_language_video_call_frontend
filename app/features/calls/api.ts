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

export async function getCallHistoryDetailList(token: string, callId: string) {
  const res = await fetch(`${CALL_API_URL}/${callId}`, {
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

export async function callFriends(token: string, requestId: number) {
  const res = await fetch(`${CALL_API_URL}/start/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ receiver_id: requestId }),
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}
