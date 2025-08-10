const BASE_URL = import.meta.env.VITE_API_BASE_URL;
if (!BASE_URL) {
  throw new Error("❌ VITE_API_BASE_URL is not defined");
}
const PAYMENT_API_URL = `${BASE_URL}/api/payments`;

export async function CreateOrder(token: string, buyAmount: number) {
  const res = await fetch(`${PAYMENT_API_URL}/create/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price: buyAmount * 1000,
    }),
  });
  if (!res.ok) {
    throw new Error("Failed to fetch profile");
  }
  //order ID,amount를 받아야함
  const data = await res.json();
  return {
    orderId: data.order_id,
    amount: data.amount,
  };
}

export async function ConfirmOrder(
  token: string,
  orderId: string,
  paymentKey: string,
  amount: number
) {
  const response = await fetch(`${PAYMENT_API_URL}/confirm/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderId, paymentKey, amount }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      `Payment confirmation failed: ${response.status} ${JSON.stringify(errorData)}`
    );
  }
}
