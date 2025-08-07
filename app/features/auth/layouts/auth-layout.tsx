import { Outlet, redirect, useLocation } from "react-router";
import { getLoggedInUserId } from "../quries";
import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/auth-layout";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const userId = await getLoggedInUserId(client);

  const url = new URL(request.url);
  const pathname = url.pathname;
  //로그인한 유저가 /auth/logout 제외한 페이지에 접근하면 메인페이지로 리다이렉트
  if (userId && pathname !== "/auth/logout") {
    return redirect("/");
  }
  return null;
};

export default function AuthLayout() {
  const location = useLocation();
  const isSignup = location.pathname.includes("/signup");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            {isSignup ? "Sign Up" : "Sign In"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isSignup ? "Create your account" : "Access your account"}
          </p>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
