import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/social-start-page";
import { makeSSRClient } from "~/supa-client";

const isDev = import.meta.env.DEV;
const BASE_URL =
  import.meta.env.VITE_BASE_URL ??
  "https://https://sign-language-video-call-frontend.vercel.app";
const DEV_BASE_URL = "http://localhost:5173";
const paramsSchema = z.object({
  provider: z.enum(["github", "kakao"]),
});

export const loader = async ({ params, request }: Route.LoaderArgs) => {
  const { success, data } = paramsSchema.safeParse(params);
  if (!success) {
    return redirect("/auth/login");
  }

  const { provider } = data;
  const redirectTo = `${BASE_URL}/auth/social/${provider}/complete`;

  const { client, headers } = makeSSRClient(request);
  const {
    data: { url },
    error,
  } = await client.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
    },
  });

  if (url) {
    return redirect(url, { headers });
  }
  if (error) {
    throw error;
  }
};
