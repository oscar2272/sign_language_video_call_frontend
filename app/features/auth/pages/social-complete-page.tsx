import { z } from "zod";
import type { Route } from "./+types/social-start-page";
import { redirect } from "react-router";
import { makeSSRClient } from "~/supa-client";
import { SocialLogin } from "../api";

const paramsSchema = z.object({
  provider: z.enum(["github", "kakao"]),
});

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const { success, data } = paramsSchema.safeParse(params);
  if (!success) {
    return redirect("/auth/signin");
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) {
    return redirect("/auth/signin");
  }
  const { client, headers } = makeSSRClient(request);
  const { data: sessionData, error } =
    await client.auth.exchangeCodeForSession(code);
  if (error || !sessionData.session?.access_token) {
    return redirect("/auth/signin");
  }

  const token = sessionData.session.access_token;

  // 장고연동
  await SocialLogin(token);

  return redirect("/", { headers });
};
