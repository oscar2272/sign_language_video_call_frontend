const BASE_URL = process.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const FRIEND_API_URL = `${BASE_URL}/api/friends`;

export async function getSentRequest(token: string) {
  const res = await fetch(`${FRIEND_API_URL}/requests/sent/`, {
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

export async function getReceivedRequest(token: string) {
  const res = await fetch(`${FRIEND_API_URL}/requests/received/`, {
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

export async function getFriends(token: string) {
  const res = await fetch(`${FRIEND_API_URL}/`, {
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

export async function requestFriend(token: string, userId: number) {
  const res = await fetch(`${FRIEND_API_URL}/requests/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to_user: userId,
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to request friend");
  }

  return res.json();
}

export async function acceptFriendRequest(token: string, requestId: number) {
  const res = await fetch(`${FRIEND_API_URL}/requests/${requestId}/accept/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}

export async function rejectFriendRequest(token: string, requestId: number) {
  const res = await fetch(`${FRIEND_API_URL}/requests/${requestId}/reject/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return res.json();
}

export async function deleteFriend(token: string, requestId: number) {
  const res = await fetch(`${FRIEND_API_URL}/${requestId}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return true;
}

export async function cancelFriendRequest(token: string, requestId: number) {
  const res = await fetch(`${FRIEND_API_URL}/requests/${requestId}/`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to accept friend request");
  }

  return true;
}
