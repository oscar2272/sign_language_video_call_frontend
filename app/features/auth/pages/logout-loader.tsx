import { makeSSRClient } from "~/supa-client";
import { redirect } from "react-router";
import type { Route } from "./+types/logout-loader";
export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client, headers } = makeSSRClient(request);
  await client.auth.signOut();
  return redirect("/auth/signin", { headers });
};
