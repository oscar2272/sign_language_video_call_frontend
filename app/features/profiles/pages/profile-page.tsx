import { Link, useOutletContext } from "react-router";
import type { UserProfile } from "../type";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "~/common/components/ui/avatar";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/common/components/ui/button";
import {
  loadTossPayments,
  ANONYMOUS,
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import { CreateOrder } from "../payment-api";
import { makeSSRClient } from "~/supa-client";
import { getLoggedInUserId } from "~/features/auth/quries";
import type { Route } from "./+types/profile-page";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const userId = await getLoggedInUserId(client);
  return { userId };
};
export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [credits, setCredits] = useState({
    remained_credit: 5,
  });

  const [buyAmount, setBuyAmount] = useState(0);
  const pricePerCredit = 1000; // 1크레딧당 1000원
  const minutesPerCredit = 10; // 1크레딧당 10분

  const totalPrice = (buyAmount * pricePerCredit).toFixed(0); // 총 금액 (원 단위, 소수점 없음)
  const totalMinutes = buyAmount * minutesPerCredit;

  // 카드에 표시할 간단한 '카드번호' 디자인
  const fakeCardNumber = "**** 1234 **** 3453";

  const widgets = useRef<TossPaymentsWidgets | null>(null);
  const initedToss = useRef<boolean>(false);
  useEffect(() => {
    const initToss = async () => {
      const clientKey = import.meta.env.VITE_TOSS_CLIENT_KEY;
      if (initedToss.current) return;
      initedToss.current = true;
      const toss = await loadTossPayments(clientKey);
      widgets.current = await toss.widgets({
        customerKey: loaderData.userId!,
      });
      await widgets.current.setAmount({
        value: 0,
        currency: "KRW",
      });
      await widgets.current.renderPaymentMethods({
        selector: "#toss-payment-methods",
      });
      await widgets.current.renderAgreement({
        selector: "#toss-payment-agreement",
      });
    };
    initToss();
  }, []);
  useEffect(() => {
    const updateAmount = async () => {
      if (widgets.current) {
        await widgets.current.setAmount({
          value: buyAmount * 1000,
          currency: "KRW",
        });
      }
    };
    updateAmount();
  }, [buyAmount]);

  // 1. 결제하기 버튼 onClick 핸들러
  async function handlePayment(token: string, buyAmount: number) {
    try {
      // 2. 백엔드에 주문 생성 요청

      const { orderId, amount } = await CreateOrder(token, buyAmount);

      // 3. Toss Payments 위젯에 주문 ID 등 넘겨 결제 시작
      if (widgets.current) {
        await widgets.current.requestPayment({
          orderId: orderId, //crypto.randomUUID
          orderName: `크레딧 ${amount / 1000}개`,
          customerEmail: "",
          metadata: {
            amount,
          },
          successUrl: `${window.location.origin}/credits/success`,
          failUrl: `${window.location.origin}/credits/fail`,
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

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
                  AI 서비스 이용 가능 시간:{" "}
                  {credits.remained_credit * minutesPerCredit} 분
                </p>
              </div>

              <div className="flex justify-between items-center mt-6 text-sm font-medium">
                <div className="flex items-center gap-1">
                  <span className="text-xl">💳</span>
                  <span>크레딧 잔액</span>
                </div>
                <p className="text-lg font-semibold">
                  {credits.remained_credit * pricePerCredit} 원
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
                      const inputValue = e.target.value;
                      const num = inputValue === "" ? 0 : Number(inputValue);
                      const val = Math.max(0, Math.min(1000, num));
                      setBuyAmount(val);
                    }}
                    className="border rounded px-3 py-1 w-20 text-center text-sm"
                  />

                  {/* 총 금액 및 이용 가능 시간 */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4 text-gray-700 text-sm mt-3 sm:mt-0">
                    <p>
                      총 금액:{" "}
                      <span className="font-semibold text-orange-600">
                        {totalPrice} 원
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
                      onClick={() => handlePayment(token, buyAmount)}
                      disabled={buyAmount === 0}
                    >
                      결제하기
                    </Button>
                  </div>
                </div>
              </div>

              {/* 크레딧 사용 내역 */}
              {/* <div>
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
              </div> */}

              {/* 결제 ui */}
              <div className="col-span-2">
                <div id="toss-payment-methods" />
                <div id="toss-payment-agreement" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
