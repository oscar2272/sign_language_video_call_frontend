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
  type TossPaymentsWidgets,
} from "@tosspayments/tosspayments-sdk";
import { CreateOrder } from "../payment-api";
import { makeSSRClient } from "~/supa-client";
import { getLoggedInUserId } from "~/features/auth/quries";
import type { Route } from "./+types/profile-page";
import { getCredit } from "../credit-api";
import { toast } from "sonner";
import { Input } from "~/common/components/ui/input";
import { Label } from "~/common/components/ui/label";
import { subscribePush } from "../subscription-api";

export const loader = async ({ request }: Route.LoaderArgs) => {
  const { client } = makeSSRClient(request);
  const userId = await getLoggedInUserId(client);
  const token = await client.auth
    .getSession()
    .then((r) => r.data.session?.access_token);
  if (!token) {
    return { globalError: "로그인이 필요합니다." };
  }
  const credit = await getCredit(token);
  return { userId, credit };
};

const formatDate = (dateString: string | null) => {
  if (!dateString) return null;
  const date = new Date(dateString);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const { user, token } = useOutletContext<{
    user: UserProfile;
    token: string;
  }>();

  const [credits, setCredits] = useState({
    remained_credit: loaderData.credit.remained_credit,
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
  const agreementWidgetRef = useRef<any>(null);
  const [agreed, setAgreed] = useState(true);

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
      const agreementWidget = await widgets.current.renderAgreement({
        selector: "#toss-payment-agreement",
        variantKey: "AGREEMENT",
      });

      agreementWidgetRef.current = agreementWidget;

      // 이벤트 연결
      agreementWidget.on("agreementStatusChange", (status) => {
        setAgreed(status.agreedRequiredTerms);
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
      if (!agreed) {
        toast("필수 약관에 동의해주세요.");
        return;
      }

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

  // URL-safe Base64 → Uint8Array 변환
  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = atob(base64);
    return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function handleSubscribe(token: string) {
    const sw = await navigator.serviceWorker.ready;

    const publicKey =
      "BF3DJ45XnJt1DDETmeeIoSZLVFqpWcdY2v0bDcrbs8IqhTBf_da2Dv_TkXz8DVoKvuvUtioPnbWD1nqpbvxaSbo";

    const arr = urlBase64ToUint8Array(publicKey);
    console.log("Key length:", arr.length);

    const subscription = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await subscribePush(token, subscription);
  }

  return (
    <div className="min-h-screen bg-gray-50 px-15">
      <div className=" mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">마이페이지</h1>

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
                  <Link to="/profiles/edit">프로필 수정</Link>
                </Button>

                {/* 🔔 푸시 알림 버튼 추가 */}
                <div className="mt-6 flex flex-col items-center">
                  <Button
                    onClick={() => handleSubscribe(token)}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded font-medium transition-colors"
                  >
                    브라우저 알림 켜기
                  </Button>
                  <p className="text-xs text-gray-500 mt-1 text-center">
                    AI 통화 알림 및 공지 수신
                  </p>
                </div>
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
          <div className="lg:col-span-2 flex flex-col gap-8 px-4">
            {/* 크레딧 잔액 카드 */}
            <div
              className="
              min-h-[300px] rounded-2xl
              bg-gradient-to-br from-orange-100 via-orange-200 to-orange-300
              shadow-md
              p-6
              flex flex-col
              text-orange-800
              relative
              overflow-hidden
              font-sans
            "
            >
              {/* 카드 번호 디자인 */}
              <div className="absolute top-6 right-8 text-xs font-mono tracking-widest opacity-25 select-none">
                {fakeCardNumber}
              </div>

              {/* 상단: 메인 크레딧 정보 */}
              <div className="flex-1">
                <p className="text-4xl font-bold tracking-tight mb-2">
                  {loaderData.credit.remained_credit} 크레딧
                </p>
                <p className="text-base font-semibold mb-4 opacity-90">
                  AI 서비스 이용 가능 시간:{" "}
                  {loaderData.credit.remained_credit * minutesPerCredit} 분
                </p>

                {/* API 연결 실패 시 안내 메시지 */}
                {loaderData.credit.remained_credit === 0 &&
                  !loaderData.credit.last_updated && (
                    <p className="text-sm mt-3 opacity-70 bg-orange-200/50 px-3 py-2 rounded-lg">
                      ⚠️ 크레딧 정보를 불러오지 못했습니다
                    </p>
                  )}
              </div>

              {/* 하단: 금액 정보와 상태 */}
              <div className="space-y-3 border-t border-orange-300/30 pt-4">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💳</span>
                    <span className="font-semibold">크레딧 잔액</span>
                  </div>
                  <p className="text-xl font-bold">
                    {loaderData.credit.remained_credit * pricePerCredit} 원
                  </p>
                </div>

                {/* 크레딧 상태 정보를 한 줄에 */}
                <div className="flex justify-between items-center text-xs opacity-70">
                  <div>
                    {formatDate(loaderData.credit.last_updated) ? (
                      <span>
                        업데이트: {formatDate(loaderData.credit.last_updated)}
                      </span>
                    ) : (
                      <span>정보 없음</span>
                    )}
                  </div>
                  <div>
                    {loaderData.credit.last_used ? (
                      <span>
                        최근 사용: {formatDate(loaderData.credit.last_used)}
                      </span>
                    ) : (
                      <span>아직 사용하지 않음</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 크레딧 구매 + 사용 내역 */}
            <div className="flex flex-col gap-8 p-0 border-0 shadow-none bg-transparent">
              {/* 크레딧 구매 UI */}
              <div>
                <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                  크레딧 구매
                </h3>

                <div className="space-y-4">
                  {/* 첫 번째 줄: 크레딧 수 입력과 계산된 정보 */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:gap-4">
                    {/* 왼쪽: 라벨 + 인풋 */}
                    <div className="flex items-center gap-3">
                      <Label
                        htmlFor="credit-input"
                        className="font-medium text-gray-700 text-sm whitespace-nowrap"
                      >
                        구매할 크레딧 수:
                      </Label>
                      <Input
                        id="credit-input"
                        type="number"
                        min={0}
                        max={1000}
                        value={buyAmount}
                        onChange={(e) => {
                          const inputValue = e.target.value;
                          const num =
                            inputValue === "" ? 0 : Number(inputValue);
                          const val = Math.max(0, Math.min(1000, num));
                          setBuyAmount(val);
                        }}
                        className="border border-gray-300 rounded px-3 py-2 w-24 text-center text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                    </div>

                    {/* 오른쪽: 카드 */}
                    {buyAmount > 0 && (
                      <div className="flex-1 bg-orange-50 rounded-lg p-3 sm:mt-0">
                        <div className="flex items-center justify-between text-sm gap-4 flex-wrap">
                          <div className="text-gray-600 flex gap-6">
                            <div>
                              총 금액:{" "}
                              <span className="font-semibold text-orange-600">
                                {totalPrice}원
                              </span>
                            </div>
                            <div>
                              이용시간:{" "}
                              <span className="font-semibold">
                                {totalMinutes}분
                              </span>
                            </div>
                          </div>

                          <Button
                            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-2 rounded-lg shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => handlePayment(token, buyAmount)}
                            disabled={buyAmount === 0}
                          >
                            결제하기
                          </Button>
                        </div>
                      </div>
                    )}
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
