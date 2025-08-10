import z from "zod";
import type { Route } from "./+types/credit-success-page";
import { ConfirmOrder } from "../payment-api";
import { makeSSRClient } from "~/supa-client";
import { redirect } from "react-router";

const paramSchema = z.object({
  paymentType: z.string(),
  orderId: z.string(),
  paymentKey: z.string(),
  amount: z.coerce.number(),
});
const secretKey = import.meta.env.VITE_TOSS_SECRET_KEY;

export const loader = async ({ request }: Route.LoaderArgs) => {
  const url = new URL(request.url);
  const { success, error, data } = paramSchema.safeParse(
    Object.fromEntries(url.searchParams)
  );
  if (!success) {
    return new Response(null, { status: 400 });
  }

  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) return null;

  // 백엔드에서 검증
  await ConfirmOrder(token, data.orderId, data.paymentKey, data.amount);
  return redirect("/profiles");
};
