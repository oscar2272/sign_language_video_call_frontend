import { makeSSRClient } from "~/supa-client";
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
import type { UserProfile } from "~/features/profiles/type";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);

  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) return redirect("/auth/signin");

  const user = await getUserProfile(token);
  return { user, hasNotifications: true, token };
};

export default function Layout({ loaderData }: Route.ComponentProps) {
  const { user, token, hasNotifications } = loaderData;
  const profile = user.profile;

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/service-worker.js")
        .then((registration) => console.log("SW 등록 완료", registration))
        .catch(console.error);

      navigator.serviceWorker.addEventListener("message", (event) => {
        const data = event.data;
        if (data?.type === "incoming_call") {
          setIncomingCall({
            room_id: data.room_id,
            from_user_id: data.from_user_id,
            from_user_name: data.from_user_name,
          });
        }
      });
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="w-full bg-white border-b shadow-sm">
        {/* ... header 코드 동일 ... */}
      </header>

      <main className="flex-1 pt-20 xl:px-40 lg:px-32 md:px-16 px-8">
        <Outlet context={{ user, token }} />
      </main>

      {incomingCall && <IncomingCallModal call={incomingCall} token={token} />}
    </div>
  );
}
