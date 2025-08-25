const BASE_URL = process.env.VITE_API_BASE_URL;
const WS_BASE_URL = process.env.VITE_WS_BASE_URL;
if (!WS_BASE_URL) {
  throw new Error("❌ VITE_WS_BASE_URL is not defined");
}
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

// 친구의 call 요청 수락
export async function acceptCall(
  token: string,
  roomId: string,
  receiverId: string
) {
  const res = await fetch(`${CALL_API_URL}/accept/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room_id: roomId, receiver_id: receiverId }),
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}

// 친구의 call 요청 거절
export async function rejectCall(
  token: string,
  roomId: string,
  callerId: string
) {
  const res = await fetch(`${CALL_API_URL}/reject/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room_id: roomId, caller_id: callerId }),
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}

// 부재중전화
export async function missCall(
  token: string,
  roomId: string,
  receiverId: string
) {
  const res = await fetch(`${CALL_API_URL}/missed/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room_id: roomId, receiver_id: receiverId }),
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}

// call 종료
export async function endCall(
  token: string,
  roomId: string,
  useCredits: string
) {
  const res = await fetch(`${CALL_API_URL}/end/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ room_id: roomId, used_credits: useCredits }),
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}
