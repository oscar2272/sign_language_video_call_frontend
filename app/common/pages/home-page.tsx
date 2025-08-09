export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-semibold mb-4">수어 통화를 시작해보세요</h1>
      <p className="mb-6 text-center text-muted-foreground max-w-sm">
        간편하고 빠르게, 필요한 순간에 바로 연결됩니다.
      </p>
      <button
        className="px-6 py-3 bg-primary text-white rounded-md hover:bg-primary/90 transition"
        onClick={() => {
          // 전화 연결 로직 또는 페이지 이동 등
          alert("전화 연결 기능 준비 중입니다.");
        }}
      >
        전화하기
      </button>
    </div>
  );
}
