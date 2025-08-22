import { browserClient, makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/layout";
import { Link, Outlet, redirect } from "react-router";
import { Button } from "../components/ui/button";

import Navigation from "../components/navigations";
import { getUserProfile } from "~/features/profiles/profile-api";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { BellIcon } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import type { IncomingCall } from "~/features/calls/type";
import IncomingCallModal from "../components/IncomingCallModal";
export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  //const userId = await getLoggedInUserId(client);

  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return redirect("/auth/signin");
  }
  const user = await getUserProfile(token);
  const hasNotifications = true;
  return { user, hasNotifications, token };
};

export default function Layout({ loaderData }: Route.ComponentProps) {
  const profile = loaderData?.user.profile;
  const user = loaderData?.user;
  const token = loaderData?.token;
  const hasNotification = loaderData?.hasNotifications;

  const userId = loaderData?.user.id; // supabase user ID
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  // --- Supabase Realtime 구독 ---
  useEffect(() => {
    if (!userId) return;
    console.log("🟢 Supabase Realtime 구독 시작", userId);
    const subscription = browserClient
      .channel(`user-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_requests",
          filter: `receiver_id=eq.${userId}`,
        },
        (payload) => {
          console.log("📩 새로운 call_requests 감지", payload);
          setIncomingCall({
            room_id: payload.new.room_id,
            from_user: payload.new.caller_id,
          });
        }
      )
      .subscribe();

    return () => {
      browserClient.removeChannel(subscription);
    };
  }, [userId]);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}

      <header className="w-full bg-white border-b shadow-sm">
        <div className="xl:px-32 lg:px-24 md:px-16 px-8">
          <div className="flex justify-between items-center h-16">
            {/* 왼쪽: 로고 + 네비 */}
            <div className="flex items-center space-x-8">
              <Link
                to="/"
                className="text-xl font-bold text-primary hover:text-primary/80 transition-colors"
              >
                Orange
              </Link>

              <div className="hidden md:flex">
                <Navigation />
              </div>
            </div>

            {/* 오른쪽: 프로필 메뉴 */}
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" asChild className="relative">
                <Link to="#" onClick={() => toast.info("준비중입니다.")}>
                  <BellIcon className="size-4" />
                  {hasNotification && (
                    <div className="absolute top-1.5 right-1.5 size-2 bg-red-500 rounded-full" />
                  )}
                </Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-10 w-10 rounded-full hover:bg-gray-100"
                  >
                    <Avatar className="h-9 w-9">
                      {profile?.profile_image_url ? (
                        <AvatarImage
                          src={profile.profile_image_url}
                          alt={profile.nickname || "User avatar"}
                          className="object-cover"
                        />
                      ) : (
                        <AvatarFallback>
                          {profile?.nickname?.[0]}
                        </AvatarFallback>
                      )}
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {profile?.nickname || "사용자"}
                      </p>
                      <p className="text-xs leading-none text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />

                  {/* <DropdownMenuItem asChild>
                    <Link to="/settings" className="cursor-pointer">
                      회원 설정
                    </Link>
                  </DropdownMenuItem> */}
                  {/* <DropdownMenuSeparator /> */}
                  <DropdownMenuItem asChild>
                    <Link
                      to="/auth/logout"
                      className="cursor-pointer text-red-600"
                    >
                      로그아웃
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* 모바일 네비게이션 */}
        <div className="md:hidden border-t bg-white">
          <div className="max-w-7xl mx-auto px-4 py-2">
            <Navigation />
          </div>
        </div>
      </header>
      {/* Content */}
      <main className="flex-1 pt-20 xl:px-40 lg:px-32 md:px-16 px-8">
        <Outlet context={{ user: loaderData!.user, token }} />
      </main>
      {/* Incoming call modal */}
      {incomingCall && (
        <IncomingCallModal
          call={incomingCall}
          onAccept={() => {
            window.location.href = `/call/${incomingCall.room_id}`;
            setIncomingCall(null);
          }}
          onReject={() => setIncomingCall(null)}
        />
      )}
    </div>
  );
}
