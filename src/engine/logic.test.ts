import { describe, expect, it } from 'vitest';
import {
  carryOver, cardTotal, companyTotal, depositTotal, ensureMonth, fmtComma, lumpTotal, monthly,
  parseDateInput, prevYm, toWon,
} from './logic';
import type { Book, Entry } from './types';

const makeId = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const entry = (p: Partial<Entry>): Entry => ({
  id: 'x', card: '국민카드', installment: false, merchant: '가맹점', amount: 10000, owner: '공통', deposit: 'N', ...p,
});

describe('parseDateInput', () => {
  it('월/일 축약을 해당 연도로 채운다', () => {
    expect(parseDateInput('8/3', 2026)).toBe('2026-08-03');
    expect(parseDateInput('8.10', 2026)).toBe('2026-08-10');
    expect(parseDateInput('12-25', 2026)).toBe('2026-12-25');
  });
  it('전체 형식도 허용한다', () => {
    expect(parseDateInput('2026-08-03')).toBe('2026-08-03');
    expect(parseDateInput('2026/8/3')).toBe('2026-08-03');
    expect(parseDateInput('20260803')).toBe('2026-08-03');
  });
  it('없는 날짜는 거른다', () => {
    expect(parseDateInput('13/1', 2026)).toBeNull();
    expect(parseDateInput('2/30', 2026)).toBeNull();
    expect(parseDateInput('abc')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });
});

describe('금액 포맷', () => {
  it('숫자만 남기고 쉼표를 찍는다', () => {
    expect(fmtComma('1234567')).toBe('1,234,567');
    expect(fmtComma('12,000원')).toBe('12,000');
    expect(fmtComma('abc')).toBe('');
  });
  it('쉼표 문자열을 원 단위 숫자로', () => {
    expect(toWon('12,000')).toBe(12000);
  });
});

describe('할부 월 납부액', () => {
  it('총액을 개월수로 나눈다', () => {
    expect(monthly(100000, 5)).toBe(20000);
    expect(monthly(1200000, 12)).toBe(100000);
  });
  it('나누어떨어지지 않으면 원 미만을 버린다', () => {
    expect(monthly(100000, 3)).toBe(33333); // 33333.33…
    expect(monthly(100000, 6)).toBe(16666); // 16666.67 → 올리지 않는다
    expect(monthly(99999, 10)).toBe(9999); // 9999.9 → 9999
  });
  it('개월수가 없으면 금액을 그대로 둔다', () => {
    expect(monthly(100000, 0)).toBe(100000);
  });
});

describe('prevYm', () => {
  it('연 경계를 넘는다', () => {
    expect(prevYm('2026-01')).toBe('2025-12');
    expect(prevYm('2026-08')).toBe('2026-07');
  });
});

describe('할부 이월', () => {
  it('할부 원금(총액)은 다음 달로 그대로 따라간다', () => {
    const prev = [entry({ installment: true, amount: 20000, totalAmount: 100000, paid: 1, months: 5 })];
    const next = carryOver(prev, makeId());
    expect(next[0]).toMatchObject({ amount: 20000, totalAmount: 100000, paid: 2, months: 5 });
  });

  it('안 끝난 할부만 납부 +1로 넘어오고 일자·입금은 리셋된다', () => {
    const prev = [
      entry({ id: 'a', installment: true, date: '2026-08-05', paid: 1, months: 6, owner: '리로', deposit: 'Y', depositAmount: 30000 }),
      entry({ id: 'b', installment: true, paid: 6, months: 6 }), // 완납 — 제외
      entry({ id: 'c', installment: false, date: '2026-08-09' }), // 일시불 — 제외
    ];
    const next = carryOver(prev, makeId());
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ paid: 2, months: 6, installment: true, owner: '리로', deposit: 'N' });
    expect(next[0].date).toBeUndefined();
    expect(next[0].depositAmount).toBeUndefined();
    expect(next[0].id).not.toBe('a');
  });

  it('ensureMonth — 처음 여는 달에 지난달 할부가 자동으로 들어간다', () => {
    const book: Book = { v: 1, months: { '2026-08': [entry({ installment: true, paid: 1, months: 6 })] } };
    const next = ensureMonth(book, '2026-09', makeId());
    expect(next.months['2026-09']).toHaveLength(1);
    expect(next.months['2026-09'][0]).toMatchObject({ paid: 2, months: 6 });
  });

  it('ensureMonth — 이미 있는 달은 그대로 둔다 (멱등)', () => {
    const book: Book = { v: 1, months: { '2026-08': [] } };
    expect(ensureMonth(book, '2026-08', makeId())).toBe(book);
  });

  it('ensureMonth — 두 달을 건너뛰어도 체인으로 이월된다', () => {
    const book: Book = { v: 1, months: { '2026-08': [entry({ installment: true, paid: 1, months: 6 })] } };
    const next = ensureMonth(book, '2026-10', makeId());
    expect(next.months['2026-09'][0]).toMatchObject({ paid: 2 });
    expect(next.months['2026-10'][0]).toMatchObject({ paid: 3 });
  });

  it('ensureMonth — 과거 데이터가 없으면 그 달 하나만 만든다', () => {
    const next = ensureMonth({ v: 1, months: {} }, '2026-08', makeId());
    expect(next.months).toEqual({ '2026-08': [] });
  });

  it('ensureMonth — 과거 달을 열어도 미래 달을 건드리지 않는다', () => {
    const book: Book = { v: 1, months: { '2026-08': [entry({ installment: true, paid: 1, months: 6 })] } };
    const next = ensureMonth(book, '2026-05', makeId());
    expect(Object.keys(next.months).sort()).toEqual(['2026-05', '2026-08']);
    expect(next.months['2026-05']).toEqual([]);
  });

  it('ensureMonth — 빈 달도 "열어본 달"이라 재이월하지 않는다', () => {
    const book: Book = { v: 1, months: { '2026-08': [entry({ installment: true, paid: 1, months: 6 })], '2026-09': [] } };
    const next = ensureMonth(book, '2026-09', makeId());
    expect(next.months['2026-09']).toEqual([]);
  });

  it('ensureMonth — 너무 오래 비워둔 달은 체인 없이 빈 달로 연다', () => {
    const book: Book = { v: 1, months: { '2020-01': [entry({ installment: true, paid: 1, months: 6 })] } };
    const next = ensureMonth(book, '2026-08', makeId());
    expect(Object.keys(next.months).sort()).toEqual(['2020-01', '2026-08']);
    expect(next.months['2026-08']).toEqual([]);
  });
});

describe('합계', () => {
  const rows = [
    entry({ amount: 10000 }),
    entry({ amount: 5000, owner: '리로', deposit: 'Y', depositAmount: 5000 }),
    entry({ installment: true, amount: 30000, paid: 1, months: 3 }),
    entry({ amount: 7000, owner: '도리', deposit: 'N', depositAmount: 9999 }), // N이면 입금 합계에서 제외
    entry({ amount: 12000, owner: '일호회사' }),
  ];

  it('일시불 합계와 총합계를 나눈다', () => {
    expect(lumpTotal(rows)).toBe(34000);
    expect(cardTotal(rows)).toBe(64000);
  });

  it('입금 합계는 Y인 행만, 일호회사 합계는 소비주체로 센다', () => {
    expect(depositTotal(rows)).toBe(5000);
    expect(companyTotal(rows)).toBe(12000);
  });

  it('실 카드사용금액 = 총합계 − 입금 합계 − 일호회사 합계', () => {
    expect(cardTotal(rows) - depositTotal(rows) - companyTotal(rows)).toBe(47000);
  });

  it('일호회사 할부도 회사 몫으로 뺀다', () => {
    const inst = [entry({ installment: true, amount: 20000, totalAmount: 100000, paid: 1, months: 5, owner: '일호회사' })];
    expect(companyTotal(inst)).toBe(20000); // 그 달 청구액 기준
  });
});
