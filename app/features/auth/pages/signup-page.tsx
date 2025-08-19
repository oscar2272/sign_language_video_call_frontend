import { Link, redirect, useFetcher } from "react-router";
import { Button } from "~/common/components/ui/button";
import { Card, CardContent, CardFooter } from "~/common/components/ui/card";
import { Input } from "~/common/components/ui/input";
import { Label } from "~/common/components/ui/label";
import { z } from "zod";

import type { Route } from "./+types/signup-page";
import { Alert, AlertTitle } from "~/common/components/ui/alert";
import { makeSSRClient } from "~/supa-client";
import { EmailSignup } from "../api";

const formSchema = z
  .object({
    email: z
      .string({ required_error: "이메일을 입력하세요." })
      .email("유효한 이메일을 입력하세요."),
    password: z.string().min(6, "비밀번호는 최소 6자리 이상이어야 합니다."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "비밀번호가 일치하지 않습니다.",
  });
export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const parsed = formSchema.safeParse(Object.fromEntries(formData));
  if (parsed.success === false) {
    const formErrors: Record<string, string> = {};

    const passwordError = parsed.error.errors.find(
      (err) => err.path[0] === "password"
    );
    if (passwordError) {
      formErrors["password"] = passwordError.message;
    }

    const confirmError = parsed.error.errors.find(
      (err) => err.path[0] === "confirmPassword"
    );
    if (confirmError) {
      formErrors["confirmPassword"] = confirmError.message;
    }

    parsed.error.errors.forEach((err) => {
      const field = err.path[0];
      if (!formErrors[field]) {
        formErrors[field] = err.message;
      }
    });

    return { formErrors }; // ✅ 항상 이 형태로 반환
  }
  const { email, password } = parsed.data;
  const { client, headers } = makeSSRClient(request);
  const { error } = await client.auth.signUp({
    email,
    password,
  });

  //supabase 회원가입 에러처리
  if (error) {
    if (error.status === 422 && error.code === "user_already_exists") {
      return { formErrors: { email: "이미 가입된 이메일입니다." } };
    }
    return { formErrors: { general: "회원가입 중 오류가 발생했습니다." } };
  }

  const { data: loginData, error: loginError } =
    await client.auth.signInWithPassword({
      email,
      password,
    });

  const freshToken = loginData.session?.access_token;
  if (!freshToken) {
    return { formErrors: { general: "로그인 후 토큰 획득 실패" } };
  }
  await EmailSignup(freshToken);
  return redirect("/", {
    headers,
  });
};
export default function SignupPage() {
  const fetcher = useFetcher();

  return (
    <Card className="w-full max-w-md mx-auto">
      <fetcher.Form method="post">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          {fetcher.data?.formErrors?.email && (
            <Alert variant="destructive">
              <AlertTitle>{fetcher.data.formErrors.email}</AlertTitle>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {fetcher.data?.formErrors?.password && (
            <Alert variant="destructive">
              <AlertTitle>{fetcher.data.formErrors.password}</AlertTitle>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">비밀번호 확인</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
            />
          </div>
          {fetcher.data?.formErrors?.confirmPassword && (
            <Alert variant="destructive">
              <AlertTitle>{fetcher.data.formErrors.confirmPassword}</AlertTitle>
            </Alert>
          )}

          {fetcher.data?.formErrors?.general && (
            <Alert variant="destructive">
              <AlertTitle>{fetcher.data.formErrors.general}</AlertTitle>
            </Alert>
          )}
        </CardContent>

        <CardFooter className="flex flex-col space-y-2 pt-4">
          <Button
            type="submit"
            className="w-full bg-slate-700 focus:bg-slate-900 hover:bg-slate-800"
          >
            회원가입
          </Button>
        </CardFooter>
      </fetcher.Form>

      <CardFooter>
        <Button
          variant="link"
          className="w-full text-sm text-muted-foreground hover:underline focus:bg-transparent"
          asChild
        >
          <Link to="/auth/signin">이미 계정이 있으신가요? 로그인</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
