export function containsHangulJamo(str: string): boolean {
  return [...str].some((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 0x3131 && code <= 0x318e; // 한글 자모 블록
  });
}

const adminWords = ["admin", "관리자", "관리", "administator"];
// 관리자,admin 등 포함된 닉네임 사용 금지
export function containsAdmin(str: string): boolean {
  const lower = str.toLowerCase();
  return adminWords.some((word) => lower.includes(word));
}
