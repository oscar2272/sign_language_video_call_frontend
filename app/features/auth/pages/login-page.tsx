import { makeSSRClient } from "~/supa-client";
import type { Route } from "./+types/login-page";
import { z } from "zod";
import { Link, redirect, useFetcher } from "react-router";
import { Card, CardContent, CardFooter } from "~/common/components/ui/card";
import { Input } from "~/common/components/ui/input";
import { Label } from "~/common/components/ui/label";
import { Button } from "~/common/components/ui/button";
import { Alert, AlertTitle } from "~/common/components/ui/alert";

const formSchema = z.object({
  email: z.string().email("유효한 이메일을 입력하세요."),
  password: z.string().min(6, "비밀번호는 최소 6자리 이상이어야 합니다."),
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { formErrors: parsed.error.flatten().fieldErrors };
  }

  const { client, headers } = makeSSRClient(request);
  const { email, password } = parsed.data;

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    switch (error.code) {
      case "email_not_confirmed":
        return {
          formErrors: {
            general:
              "이메일 인증이 완료되지 않았습니다. 이메일을 확인해주세요.",
          },
        };
      case "invalid_login_credentials":
        return {
          formErrors: {
            general: "이메일 또는 비밀번호가 올바르지 않습니다.",
          },
        };
      case "user_not_found":
        return {
          formErrors: {
            general: "등록된 이메일이 없습니다. 회원가입 해주세요.",
          },
        };
      default:
        return {
          formErrors: {
            general: `로그인 실패: ${error.message}`,
          },
        };
    }
  }

  return redirect("/", { headers });
};

export default function LoginPage({ actionData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  return (
    <div className="w-full max-w-md mx-auto">
      <Card>
        <fetcher.Form method="post">
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            {fetcher.data?.formErrors?.password && (
              <Alert variant="destructive" className="mt-1">
                <AlertTitle>{fetcher.data.formErrors.password}</AlertTitle>
              </Alert>
            )}

            <div>
              <Button type="submit" className="w-full">
                로그인
              </Button>
            </div>
          </CardContent>
          {fetcher.data?.formErrors?.general && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>{fetcher.data.formErrors.general}</AlertTitle>
            </Alert>
          )}
        </fetcher.Form>

        <CardFooter>
          <Button variant="outline" className="w-full bg-background" asChild>
            <Link to="/auth/signup">회원가입</Link>
          </Button>
        </CardFooter>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-300" />
        <span className="text-sm text-gray-500 whitespace-nowrap">
          Login with Social
        </span>
        <div className="flex-1 h-px bg-gray-300" />
      </div>

      <div className="mt-4 flex flex-col gap-2 items-center">
        <Button
          className="w-75 h-[45px] flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white border-0"
          asChild
        >
          <Link to="/auth/social/github/start">
            <img
              src="/icons/github-mark-white.svg"
              alt="GitHub logo"
              className="w-5 h-5"
            />
            GitHub 로그인
          </Link>
        </Button>

        <Link to="/auth/social/kakao/start">
          <img
            src="/buttons/kakao_login_medium_wide.png"
            alt="Kakao Login"
            className="w-auto h-auto items-center"
          />
        </Link>
      </div>
    </div>
  );
}
