// 순수 계산 로직 — UI·저장소에 의존하지 않는다.
import type { Book, Card, Entry } from './types';

/**
 * 로그인 계정별로 입력 폼에 먼저 골라둘 카드.
 * 각자 자기 카드를 주로 적으니 매번 고르지 않아도 되게 한다. 고정은 아니라 바꿀 수 있다.
 */
const CARD_BY_EMAIL: Record<string, Card> = {
  'park3650@gmail.com': '국민카드',
};
export const defaultCard = (email: string): Card =>
  CARD_BY_EMAIL[email.trim().toLowerCase()] ?? '삼성카드';

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ym = (y: number, m: number) => `${y}-${pad2(m)}`;

export const todayYm = () => {
  const d = new Date();
  return ym(d.getFullYear(), d.getMonth() + 1);
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export function prevYm(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? ym(y - 1, 12) : ym(y, m - 1);
}

export function nextYm(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
}

/** 'YYYY-MM' 형태인지 (month input·저장 키 검증용) */
export const isYm = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** '8/3'·'8-3'·'8.3' → 해당 연도 8월 3일. '2026-08-03'·'20260803'도 허용. 실패하면 null */
export function parseDateInput(raw: string, year = new Date().getFullYear()): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) ?? s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validYmd(year, +m[1], +m[2]);
  return null;
}

function validYmd(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(y, mo, 0).getDate()) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 입력 문자열에서 숫자만 남기고 천 단위 쉼표를 찍는다 */
export const fmtComma = (s: string) => {
  const digits = s.replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('ko-KR') : '';
};

export const toWon = (s: string) => Number(s.replace(/\D/g, '')) || 0;
export const fmtWon = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 지난달에 안 끝난 할부(납부 < 총)를 다음 달 행으로 — 납부 +1, 일자는 비우고 입금여부는 새 달이니 N으로 리셋 */
export function carryOver(prev: Entry[], newId: () => string): Entry[] {
  return prev
    .filter(e => e.installment && (e.paid ?? 0) < (e.months ?? 0))
    .map(({ date: _date, depositAmount: _amt, ...e }) => ({ ...e, id: newId(), paid: (e.paid ?? 0) + 1, deposit: 'N' as const }));
}

/** 이월 체인의 상한 — 이보다 오래 비워둔 달은 할부를 따라가지 않고 빈 달로 연다 */
const MAX_CARRY = 36;

/**
 * month를 처음 여는 달이면 만들어 준다.
 * 과거에 기록이 있으면 가장 가까운 기록 달부터 한 달씩 할부를 이월해 채운다.
 * 키가 빈 배열이어도 "이미 열어본 달"이라는 표식이라 다시 이월하지 않는다.
 */
export function ensureMonth(book: Book, month: string, newId: () => string): Book {
  if (book.months[month]) return book;
  const last = Object.keys(book.months).filter(k => k < month).sort().pop();
  if (!last) return { ...book, months: { ...book.months, [month]: [] } };

  const chain: string[] = [];
  for (let cur = month; cur > last && chain.length <= MAX_CARRY; cur = prevYm(cur)) chain.unshift(cur);
  if (chain.length > MAX_CARRY) return { ...book, months: { ...book.months, [month]: [] } };

  const months = { ...book.months };
  for (const m of chain) months[m] = carryOver(months[prevYm(m)] ?? [], newId);
  return { ...book, months };
}

/** 할부 원금 → 월 납부액. 나누어떨어지지 않으면 원 미만은 버린다(표에서 직접 고칠 수 있다) */
export const monthly = (total: number, months: number) =>
  months > 0 ? Math.floor(total / months) : total;

/** 일시불 합계 */
export const lumpTotal = (rows: Entry[]) => rows.filter(e => !e.installment).reduce((s, e) => s + e.amount, 0);
/** 총합계 (일시불 + 할부) */
export const cardTotal = (rows: Entry[]) => rows.reduce((s, e) => s + e.amount, 0);
/** 개인사용 입금 합계 — 입금여부 Y인 행의 입금금액 */
export const depositTotal = (rows: Entry[]) =>
  rows.reduce((s, e) => s + (e.deposit === 'Y' ? e.depositAmount ?? 0 : 0), 0);
/** 일호회사 합계 — 회사 몫이라 실 카드사용금액에서 따로 뺀다 */
export const companyTotal = (rows: Entry[]) =>
  rows.reduce((s, e) => s + (e.owner === '일호회사' ? e.amount : 0), 0);
