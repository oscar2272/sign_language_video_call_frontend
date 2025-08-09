import { makeSSRClient } from "~/supa-client";
import { containsAdmin, containsHangulJamo } from "../utils/name-filter";
import type { Route } from "./+types/profile-edit-page";
import { z } from "zod";
import { updateUserProfile } from "../api";
import { Form, redirect, useNavigate, useOutletContext } from "react-router";
import { Button } from "~/common/components/ui/button";
import { ArrowLeft } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "~/common/components/ui/alert";
import { Label } from "~/common/components/ui/label";
import { Input } from "~/common/components/ui/input";
import type { UserProfile } from "../type";
import { useState } from "react";
const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];
const formSchema = z.object({
  name: z
    .string()
    .min(3, "최소 3자 이상 15자 이하로 입력해주세요.")
    .max(15, "최소 3자 이상 15자 이하로 입력해주세요.")
    .regex(/^[\p{L}0-9]+$/u, "문자, 숫자만 사용할 수 있습니다.")
    .refine((val) => !containsHangulJamo(val), {
      message: "한글 (초성)만으로 이루어진 닉네임은 사용할 수 없습니다.",
    })
    // .refine((val) => !containsProfanity(val), {
    //   message: "비속어를 포함할 수 없습니다.",
    // })
    .refine((val) => !containsAdmin(val), {
      message: "관리자 닉네임은 사용할 수 없습니다.",
    }),
  avatar: z.preprocess(
    (file) => {
      if (
        file instanceof File &&
        file.size === 0 &&
        file.name === "" &&
        file.type === "application/octet-stream"
      ) {
        return undefined; // 빈 파일은 무시
      }
      return file;
    },
    z
      .any()
      .refine(
        (file) =>
          file === undefined || file instanceof File || file instanceof Blob,
        { message: "유효한 파일이 아닙니다." }
      )
      .refine((file) => !file || file.size <= MAX_FILE_SIZE, {
        message: "파일 크기는 3MB 이하여야 합니다.",
      })
      .refine((file) => !file || ACCEPTED_IMAGE_TYPES.includes(file.type), {
        message: "PNG, JPEG, JPG, WEBP 형식만 허용됩니다.",
      })
      .optional()
  ),
});

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData();
  const formValues = Object.fromEntries(formData);
  if (!formValues?.avatar && !formValues?.name) {
    return null;
  }
  const { success, data, error } = formSchema.safeParse(
    Object.fromEntries(formData)
  );
  if (!success) {
    return { formErrors: error.flatten().fieldErrors };
  }
  const { name, avatar } = data;
  const { client } = makeSSRClient(request);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return { globalError: "로그인이 필요합니다." };
  }
  console.log("avatar,name", avatar, name);

  const status = await updateUserProfile(token, avatar ?? null, name);
  if (status == 200) {
    return redirect("/profiles");
  } else {
    return { globalError: "프로필 수정에 실패했습니다." };
  }
};

export default function ProfileEditPage({ actionData }: Route.ComponentProps) {
  const { user } = useOutletContext<{ user: UserProfile }>();
  const [avatar, setAvatar] = useState<string | null>(
    user.profile.profile_image_url ?? null
  );

  const navigate = useNavigate();

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setAvatar(URL.createObjectURL(file));
    }
  };

  return (
    <div className="py-10 px-8 max-w-4xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-center gap-4 mb-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/profiles")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-3xl font-semibold">프로필 수정</h1>
      </div>

      <Form
        method="post"
        encType="multipart/form-data"
        className="flex flex-col md:flex-row gap-12"
      >
        {/* 좌측: 프로필 이미지 */}
        <div className="flex flex-col items-center md:w-1/3">
          <label
            htmlFor="avatar-upload"
            className="cursor-pointer rounded-full overflow-hidden shadow-lg w-40 h-40 flex items-center justify-center border border-gray-300 hover:border-indigo-500 transition"
            aria-label="프로필 이미지 변경"
          >
            {avatar ? (
              <img
                src={avatar}
                alt="Avatar"
                className="object-cover w-full h-full"
              />
            ) : (
              <div className="text-gray-400 text-xl select-none">No Image</div>
            )}
          </label>
          <input
            id="avatar-upload"
            type="file"
            name="avatar"
            accept="image/png, image/jpeg, image/jpg, image/webp"
            className="hidden"
            onChange={onChange}
          />

          <div className="mt-4 text-xs text-gray-500 space-y-0.5 text-center select-none">
            <p>Recommended size: 128x128px</p>
            <p>Allowed formats: PNG, JPEG, JPG, WEBP</p>
            <p>Max file size: 3MB</p>
          </div>

          <p className="mt-2 text-sm text-gray-600 text-center select-none">
            프로필 이미지를 변경하려면 클릭하세요
          </p>

          {actionData?.formErrors?.avatar && (
            <Alert variant="destructive" className="mt-4 w-full max-w-xs">
              <AlertTitle>이미지 업로드 오류</AlertTitle>
              <AlertDescription>
                {actionData.formErrors.avatar.join(", ")}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* 우측: 프로필 정보 폼 */}
        <div className="md:w-2/3 flex flex-col gap-8">
          <div className="space-y-3">
            <Label htmlFor="name" className="text-lg font-medium">
              닉네임
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={user.profile.nickname}
              className="text-lg h-12 rounded-md border border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 transition"
              autoComplete="off"
            />
            {actionData?.formErrors?.name && (
              <Alert variant="destructive" className="mt-2">
                <AlertTitle>{actionData.formErrors.name.join(", ")}</AlertTitle>
              </Alert>
            )}
          </div>

          <div className="space-y-3">
            <Label htmlFor="email" className="text-lg font-medium">
              이메일
            </Label>
            <Input
              id="email"
              type="email"
              value={user.email}
              disabled
              className="text-lg h-12 rounded-md bg-gray-100 border border-gray-300 cursor-not-allowed"
            />
            <p className="text-sm text-gray-500 select-none">
              이메일은 변경할 수 없습니다
            </p>
          </div>

          {actionData?.globalError && (
            <Alert variant="destructive" className="w-full">
              <AlertTitle>{actionData.globalError}</AlertTitle>
            </Alert>
          )}

          {/* 버튼 그룹 */}
          <div className="flex gap-4 mt-6">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => navigate("/profiles")}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="default"
              size="lg"
              className="flex-1"
            >
              변경사항 저장
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}
