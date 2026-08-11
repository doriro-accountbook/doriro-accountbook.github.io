// 카드 가계부 도메인 — v1 스키마. 필드가 바뀌면 v를 올리고 storage에서 마이그레이션한다.

export const CARDS = ['국민카드', '삼성카드'] as const;
export type Card = (typeof CARDS)[number];

export const OWNERS = ['리로', '도리', '공통', '일호회사'] as const;
export type Owner = (typeof OWNERS)[number];

export interface Entry {
  id: string;
  card: Card;
  /** true = 할부, false = 일시불 */
  installment: boolean;
  /** 'YYYY-MM-DD'. 이월된 할부 행은 특정 일자가 없다 */
  date?: string;
  merchant: string;
  /** 이 달에 청구되는 금액(원). 할부면 월 납부액 = totalAmount / months */
  amount: number;
  /** 할부일 때만: 할부 원금(총 결제금액). 개월수를 고치면 여기서 월 납부액을 다시 계산한다 */
  totalAmount?: number;
  /** 할부일 때만: 납부한 개월수 / 총 개월수 */
  paid?: number;
  months?: number;
  owner: Owner;
  /** 생활비 통장 입금여부 — 소비주체가 리로·도리(개인)일 때만 선택, 그 외엔 항상 'N' */
  deposit: 'Y' | 'N';
  /** 입금여부 Y일 때 입금한 금액(원) */
  depositAmount?: number;
  detail?: string;
}

/** 'YYYY-MM' → 그 달의 행들. 키가 존재하면 이미 열어본(할부 이월이 끝난) 달 */
export interface Book {
  v: 1;
  months: Record<string, Entry[]>;
}

export const emptyBook = (): Book => ({ v: 1, months: {} });
