import type { Route } from "./+types/profile-page";
import { Link, useOutletContext } from "react-router";
import type { UserProfile } from "../type";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { useState } from "react";
import { Button } from "~/common/components/ui/button";

export default function ProfilePage() {
  const { user } = useOutletContext<{ user: UserProfile }>();

  const [credits, setCredits] = useState({
    remained_credit: 5,
  });

  const usageHistory = [
    {
      date: "2024-08-08",
      amount: -1,
      description: "AI 서비스 사용",
      remaining: 4,
    },
    {
      date: "2024-08-06",
      amount: +5,
      description: "크레딧 충전",
      remaining: 5,
    },
  ];

  const [buyAmount, setBuyAmount] = useState(1);

  const pricePerCredit = 1 / 20; // 1크레딧당 $0.05
  const totalPrice = (buyAmount * pricePerCredit).toFixed(2);
  const totalMinutes = buyAmount;

  // 카드에 표시할 간단한 '카드번호' 같은 텍스트 (예시)
  const fakeCardNumber = "**** 1234 **** 3453";

  return (
    <div className="min-h-screen bg-gray-50 px-10">
      <div className=" mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">프로필</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 왼쪽 프로필 섹션 (평면) */}
          <div className="lg:col-span-1">
            <div className="p-6">
              {/* 프로필 이미지 */}
              <div className="flex flex-col items-center mb-6">
                <div className="mb-4">
                  <Avatar className="w-24 h-24">
                    {user.profile?.profile_image_url ? (
                      <AvatarImage
                        src={user.profile.profile_image_url}
                        alt={user.profile.nickname}
                        className="object-cover"
                      />
                    ) : (
                      <AvatarFallback className="text-2xl">
                        {user.profile.nickname?.[0]}
                      </AvatarFallback>
                    )}
                  </Avatar>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">
                  {user.profile.nickname}
                </h2>
                <p className="text-gray-600 mb-4">{user.email}</p>

                <Button
                  asChild
                  className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded font-medium transition-colors"
                >
                  <Link to="/profiles/edit">프로필 변경</Link>
                </Button>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm">계정 상태</span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      user.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {user.is_active ? "활성" : "비활성"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 text-sm">권한</span>
                  <span className="font-medium text-sm">
                    {user.is_staff ? "관리자" : "일반 사용자"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 오른쪽 크레딧 및 구매 섹션 */}
          <div className="lg:col-span-2 flex flex-col gap-8">
            {/* 크레딧 잔액 카드 */}
            <div
              className="
              min-h-[300px] rounded-2xl
              bg-gradient-to-br from-orange-100 via-orange-200 to-orange-300
              shadow-md
              p-6
              flex flex-col justify-between
              text-orange-800
              relative
              overflow-hidden
              font-sans
            "
            >
              {/* 카드 번호 디자인 */}
              <div className="absolute top-4 right-6 text-xs font-mono tracking-widest opacity-30 select-none">
                {fakeCardNumber}
              </div>

              <div>
                <p className="text-3xl font-bold tracking-tight">
                  {credits.remained_credit} 크레딧
                </p>
                <p className="text-sm font-semibold mt-1">
                  AI 서비스 이용 가능 시간: {credits.remained_credit} 분
                </p>
              </div>

              <div className="flex justify-between items-center mt-6 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <span className="text-xl">💳</span>
                  <span>크레딧 잔액</span>
                </div>
                <p className="text-lg font-semibold">
                  ${(credits.remained_credit * pricePerCredit).toFixed(2)}
                </p>
              </div>
            </div>

            {/* 크레딧 구매 + 사용 내역 */}
            <div className="flex flex-col gap-8 p-0 border-0 shadow-none bg-transparent">
              {/* 크레딧 구매 UI */}
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                  크레딧 구매
                </h3>

                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-6">
                  {/* 구매할 크레딧 수 입력 */}
                  <label
                    htmlFor="credit-input"
                    className="font-medium text-gray-700 text-sm whitespace-nowrap"
                  >
                    구매할 크레딧 수:
                  </label>
                  <input
                    id="credit-input"
                    type="number"
                    min={0}
                    max={1000}
                    value={buyAmount}
                    onChange={(e) => {
                      const val = Math.max(
                        0,
                        Math.min(1000, Number(e.target.value))
                      );
                      setBuyAmount(val);
                    }}
                    className="border rounded px-3 py-1 w-20 text-center text-sm"
                  />

                  {/* 총 금액 및 이용 가능 시간 */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4 text-gray-700 text-sm mt-3 sm:mt-0">
                    <p>
                      총 금액:{" "}
                      <span className="font-semibold text-orange-600">
                        ${totalPrice}
                      </span>
                    </p>
                    <p>
                      이용 가능 시간:{" "}
                      <span className="font-semibold">{totalMinutes} 분</span>
                    </p>
                  </div>

                  {/* 결제하기 버튼 */}
                  <div className="mt-4 sm:mt-0 sm:ml-auto">
                    <Button
                      className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2 rounded shadow transition text-sm whitespace-nowrap"
                      onClick={() => {
                        alert(
                          `${buyAmount} 크레딧 구매 완료! 총 금액: $${totalPrice} 결제 진행하세요.`
                        );
                      }}
                    >
                      결제하기
                    </Button>
                  </div>
                </div>
              </div>

              {/* 크레딧 사용 내역 */}
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-4">
                  크레딧 사용 내역 (최근 5개)
                </h4>
                <ul className="divide-y border rounded-md text-sm">
                  {usageHistory.slice(0, 5).map((record, idx) => (
                    <li
                      key={idx}
                      className="flex justify-between px-6 py-3 hover:bg-gray-50"
                    >
                      <span>
                        {record.date} - {record.description}
                      </span>
                      <span
                        className={`font-semibold ${
                          record.amount > 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {record.amount > 0 ? "+" : ""}
                        {record.amount} 크레딧
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
