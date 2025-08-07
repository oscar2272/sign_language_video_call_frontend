import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/layout";
import { getLoggedInUserId } from "~/features/auth/quries";
import { Link, Outlet, redirect } from "react-router";
import { Button } from "../components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "../components/ui/navigation-menu";
import Navigation from "../components/navigations";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const userId = await getLoggedInUserId(client);
  if (userId == null) {
    return redirect("/auth/signin");
  }
  return { userId };
};

export default function Layout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="w-full bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        {/* 왼쪽 로고 */}
        <Link to="/" className="text-xl font-bold text-primary">
          Orange
        </Link>

        {/* 네비게이션 */}
        <Navigation />

        {/* 오른쪽 ID 및 로그아웃 */}
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            ID: {loaderData.userId}
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/auth/logout">Logout</Link>
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
