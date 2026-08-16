import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CARDS, OWNERS, type Book, type Card, type Entry, type Owner } from './engine/types';
import {
  cardTotal, companyTotal, defaultCard, depositTotal, ensureMonth, fmtComma, fmtWon, isYm, lumpTotal,
  monthly, nextYm, pad2, parseDateInput, prevYm, todayIso, todayYm, toWon,
} from './engine/logic';
import { loadBook, saveBook } from './store/storage';
import { supabase, redirectTo } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

const newId = () => crypto.randomUUID();
/** 리로·도리 = 개인 소비주체 → 입금여부·입금금액을 직접 선택 */
const isPersonal = (o: Owner) => o === '리로' || o === '도리';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const SAVE_LABEL: Record<SaveState, string> = {
  idle: '', saving: '저장 중…', saved: '저장됨', error: '저장 실패',
};

/** 로그인 상태와 장부 로딩을 맡는다. 장부가 손에 들어와야 Ledger를 그린다 */
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); setReady(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setBook(null); setErr(null); return; }
    let alive = true;
    loadBook()
      .then(b => { if (alive) setBook(b); })
      .catch(e => { if (alive) setErr(e instanceof Error ? e.message : '장부를 불러오지 못했습니다.'); });
    return () => { alive = false; };
  }, [session]);

  if (!ready) return <div className="splash">불러오는 중…</div>;

  if (!session) return (
    <div className="splash">
      <h1>카드 가계부</h1>
      <button type="button" className="primary" onClick={() => supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: redirectTo() },
      })}>구글로 로그인</button>
    </div>
  );

  if (err) return (
    <div className="splash">
      <p className="err">{err}</p>
      <p className="sub">{session.user.email}</p>
      <button type="button" onClick={() => supabase.auth.signOut()}>다른 계정으로 로그인</button>
    </div>
  );

  if (!book) return <div className="splash">장부 불러오는 중…</div>;

  return <Ledger initial={book} email={session.user.email ?? ''} />;
}

function Ledger({ initial, email }: { initial: Book; email: string }) {
  const [book, setBook] = useState<Book>(() => ensureMonth(initial, todayYm(), newId));
  const [month, setMonth] = useState(todayYm());
  const [yy, mm] = month.split('-').map(Number);
  const [save, setSave] = useState<SaveState>('idle');
  const lastSaved = useRef(JSON.stringify(initial));

  // 표에서 글자를 칠 때마다 쓰기가 나가지 않도록 잠시 모았다가 보낸다
  useEffect(() => {
    const json = JSON.stringify(book);
    if (json === lastSaved.current) return;
    setSave('saving');
    const t = setTimeout(() => {
      saveBook(book)
        .then(() => { lastSaved.current = json; setSave('saved'); })
        .catch(e => { setSave('error'); console.error(e); });
    }, 800);
    return () => clearTimeout(t);
  }, [book]);

  const goMonth = (key: string) => {
    if (!isYm(key)) return;
    setBook(b => ensureMonth(b, key, newId));
    setMonth(key);
  };

  // ---------- 입력 폼 ----------
  // 로그인한 계정이 주로 쓰는 카드를 먼저 골라둔다 (바꿀 수 있다)
  const [card, setCard] = useState<Card>(() => defaultCard(email));
  const [inst, setInst] = useState<'일시불' | '할부'>('일시불');
  const [dateStr, setDateStr] = useState(todayIso());
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState('1');
  const [total, setTotal] = useState('');
  const [owner, setOwner] = useState<Owner>('공통');
  const [deposit, setDeposit] = useState<'Y' | 'N'>('N');
  const [depositAmt, setDepositAmt] = useState('');
  const [detail, setDetail] = useState('');
  const dpRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const personal = isPersonal(owner);
  const effDeposit: 'Y' | 'N' = personal ? deposit : 'N';

  const add = (e: FormEvent) => {
    e.preventDefault();
    const won = toWon(amount);
    if (!merchant.trim()) { alert('소비처를 입력해 주세요.'); return; }
    if (!won) { alert('금액을 입력해 주세요.'); return; }
    const isInst = inst === '할부';
    const iso = dateStr.trim() ? parseDateInput(dateStr, yy) : null;
    if (dateStr.trim() && !iso) { alert('날짜 형식을 확인해 주세요. 예: 8/3 또는 2026-08-03'); return; }
    if (!isInst && !iso) { alert('일자를 입력해 주세요. 예: 8/3'); return; }
    const p = Number(paid), t = Number(total);
    if (isInst && (!t || !p || p < 1 || p > t)) { alert('할부 개월수를 확인해 주세요. (납부한 개월수 ≤ 총 개월수)'); return; }
    const dAmt = effDeposit === 'Y' ? toWon(depositAmt) : 0;
    // 할부는 입력한 금액이 총 결제금액 → 이 달 청구액은 개월수로 나눈 월 납부액
    const entry: Entry = {
      id: newId(), card, installment: isInst,
      ...(iso ? { date: iso } : {}),
      merchant: merchant.trim(), amount: isInst ? monthly(won, t) : won,
      ...(isInst ? { totalAmount: won, paid: p, months: t } : {}),
      owner, deposit: effDeposit,
      ...(dAmt ? { depositAmount: dAmt } : {}),
      ...(detail.trim() ? { detail: detail.trim() } : {}),
    };
    setBook(b => ({ ...b, months: { ...b.months, [month]: [...(b.months[month] ?? []), entry] } }));
    setMerchant(''); setAmount(''); setDepositAmt(''); setDetail('');
    if (isInst) { setPaid('1'); setTotal(''); }
  };

  // ---------- 이번 달 행 조작 ----------
  const rows = book.months[month] ?? [];
  const setRows = (fn: (rs: Entry[]) => Entry[]) =>
    setBook(b => ({ ...b, months: { ...b.months, [month]: fn(b.months[month] ?? []) } }));
  const remove = (id: string) => setRows(rs => rs.filter(r => r.id !== id));
  const patch = (id: string, p: Partial<Entry>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...p } : r)));

  /** 카드별 표시 순서 — 할부 블록 먼저(엑셀 양식과 동일), 그 안팎 모두 최신이 위로 */
  const cardRows = (c: Card) => {
    const order = new Map(rows.map((r, i) => [r.id, i]));
    const latestFirst = (a: Entry, b: Entry) =>
      (b.date ?? '').localeCompare(a.date ?? '') || order.get(b.id)! - order.get(a.id)!;
    const list = rows.filter(r => r.card === c);
    return [
      ...list.filter(r => r.installment).sort(latestFirst),
      ...list.filter(r => !r.installment).sort(latestFirst),
    ];
  };

  // ---------- 백업 ----------
  const onExport = () => {
    const blob = new Blob([JSON.stringify(book, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `카드가계부_백업_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text()) as Book;
      if (parsed.v !== 1 || typeof parsed.months !== 'object' || parsed.months === null) throw new Error('백업 파일 형식이 아닙니다.');
      const count = Object.values(parsed.months).reduce((s, a) => s + a.length, 0);
      if (confirm(`백업(총 ${count}건)으로 현재 데이터를 교체할까요?`)) setBook(ensureMonth(parsed, month, newId));
    } catch (err) {
      alert(err instanceof Error ? err.message : '파일을 읽을 수 없습니다.');
    }
  };

  const grand = cardTotal(rows);
  const depSum = depositTotal(rows);
  const compSum = companyTotal(rows);

  return (
    <div className="app">
      <header>
        <div className="ym">
          <button type="button" onClick={() => goMonth(prevYm(month))} aria-label="이전 달">‹</button>
          <input type="month" value={month} onChange={e => goMonth(e.target.value)} aria-label="년월 선택" />
          <button type="button" onClick={() => goMonth(nextYm(month))} aria-label="다음 달">›</button>
          <button type="button" className="today" onClick={() => goMonth(todayYm())} disabled={month === todayYm()}>이번 달</button>
        </div>
        <h1>{yy}년 {mm}월 가계부</h1>
        <div className="tools">
          <span className={`save ${save}`}>{SAVE_LABEL[save]}</span>
          <button type="button" onClick={onExport}>백업 저장</button>
          <button type="button" onClick={() => fileRef.current?.click()}>백업 불러오기</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
          <button type="button" title={email} onClick={() => supabase.auth.signOut()}>로그아웃</button>
        </div>
      </header>

      <form className="entry" onSubmit={add}>
        <label>카드여부
          <select value={card} onChange={e => setCard(e.target.value as Card)}>
            {CARDS.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>할부여부
          <select value={inst} onChange={e => setInst(e.target.value as '일시불' | '할부')}>
            <option>일시불</option>
            <option>할부</option>
          </select>
        </label>
        {inst === '할부' && (
          <label>할부 개월수 (납부/총)
            <span className="months-wrap">
              <input inputMode="numeric" value={paid} onChange={e => setPaid(e.target.value.replace(/\D/g, ''))} aria-label="납부한 할부개월수" />
              <span>/</span>
              <input inputMode="numeric" value={total} onChange={e => setTotal(e.target.value.replace(/\D/g, ''))} placeholder="개월" aria-label="총 할부개월수" />
            </span>
          </label>
        )}
        <label>일자
          <span className="date-wrap">
            <input
              value={dateStr}
              onChange={e => setDateStr(e.target.value)}
              onBlur={() => { const iso = parseDateInput(dateStr, yy); if (iso) setDateStr(iso); }}
              placeholder="8/3 또는 2026-08-03"
            />
            <button type="button" className="cal" aria-label="달력에서 선택" onClick={() => {
              const el = dpRef.current;
              if (!el) return;
              if (typeof el.showPicker === 'function') el.showPicker(); else el.click();
            }}>📅</button>
            <input
              ref={dpRef} type="date" className="hidden-date" tabIndex={-1} aria-hidden
              value={parseDateInput(dateStr, yy) ?? ''}
              onChange={e => setDateStr(e.target.value)}
            />
          </span>
        </label>
        <label>소비처
          <input value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="예: 굿모닝마트" />
        </label>
        <label>{inst === '할부' ? '총 결제금액' : '금액'}
          <span className="won-wrap">
            <input inputMode="numeric" value={amount} onChange={e => setAmount(fmtComma(e.target.value))} placeholder="0" />
            <span className="unit">원</span>
          </span>
        </label>
        {inst === '할부' && (
          <label>월 납부액
            <span className="won-wrap readonly">
              <input readOnly tabIndex={-1} value={
                toWon(amount) > 0 && Number(total) > 0 ? monthly(toWon(amount), Number(total)).toLocaleString('ko-KR') : ''
              } placeholder="0" />
              <span className="unit">원</span>
            </span>
          </label>
        )}
        <label>소비주체
          <select value={owner} onChange={e => {
            const o = e.target.value as Owner;
            setOwner(o);
            if (!isPersonal(o)) { setDeposit('N'); setDepositAmt(''); }
          }}>
            {OWNERS.map(o => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label>개인 입금
          <select
            value={effDeposit} disabled={!personal}
            onChange={e => { const v = e.target.value as 'Y' | 'N'; setDeposit(v); if (v === 'N') setDepositAmt(''); }}
          >
            <option>N</option>
            <option>Y</option>
          </select>
        </label>
        <label>입금금액
          <span className="won-wrap">
            <input
              inputMode="numeric" value={depositAmt} disabled={effDeposit !== 'Y'}
              onChange={e => setDepositAmt(fmtComma(e.target.value))} placeholder="0"
            />
            <span className="unit">원</span>
          </span>
        </label>
        <label className="grow">소비상세
          <input value={detail} onChange={e => setDetail(e.target.value)} placeholder="선택 입력" />
        </label>
        <button type="submit" className="primary">추가</button>
      </form>

      <div className="cards">
        {CARDS.map(c => (
          <CardSection key={c} name={c} rows={cardRows(c)} onRemove={remove} onPatch={patch} />
        ))}
      </div>

      <div className="grand">
        <span>국민카드 + 삼성카드 합계 <b>{fmtWon(grand)}</b></span>
        <span>개인사용 입금 합계 <b>−{fmtWon(depSum)}</b></span>
        <span>일호회사 합계 <b>−{fmtWon(compSum)}</b></span>
        <span className="real">실 카드사용금액 <b>{fmtWon(grand - depSum - compSum)}</b></span>
      </div>
    </div>
  );
}

function CardSection({ name, rows, onRemove, onPatch }: {
  name: Card;
  rows: Entry[];
  onRemove: (id: string) => void;
  onPatch: (id: string, p: Partial<Entry>) => void;
}) {
  return (
    <section className="card-box">
      <h2>{name} <span className="count">{rows.length}건</span></h2>
      <div className="scroll">
        <table>
          {/* 컬럼 폭을 비율로 고정 — 안 그러면 소비상세가 남는 폭을 다 먹어 나머지가 왼쪽으로 몰린다 */}
          <colgroup>
            <col style={{ width: '7%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '3%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>카드종류</th>
              <th>할부여부</th>
              <th>일자</th>
              <th>소비처</th>
              <th>금액</th>
              <th>할부개월수</th>
              <th>소비주체</th>
              <th>개인 입금</th>
              <th>입금금액</th>
              <th>소비상세</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={11} className="empty">내역 없음</td></tr>}
            {rows.map(r => {
              const personal = isPersonal(r.owner);
              return (
                <tr key={r.id} className={r.installment ? 'inst' : ''}>
                  <td className="center">{r.card}</td>
                  <td className="center">{r.installment ? '할부' : '일시불'}</td>
                  {/* 일자는 읽기 전용 — 고치면 날짜순 정렬이 바뀌면서 줄이 튀어 엉뚱한 줄을 만지게 된다.
                      날짜를 바꿔야 하면 지우고 다시 넣는다 */}
                  <td className="center">{r.date ?? ''}</td>
                  <td className="center">
                    <input
                      className="cell mid" aria-label="소비처"
                      value={r.merchant}
                      onChange={e => onPatch(r.id, { merchant: e.target.value })}
                    />
                  </td>
                  <td className="num">
                    <input
                      className="cell right" inputMode="numeric" aria-label="금액"
                      value={r.amount ? r.amount.toLocaleString('ko-KR') : ''}
                      onChange={e => onPatch(r.id, { amount: toWon(e.target.value) })}
                    />
                    {r.installment && r.totalAmount && (
                      <span className="sub">총 {r.totalAmount.toLocaleString('ko-KR')}원</span>
                    )}
                  </td>
                  <td className="center">
                    {r.installment && (
                      <span className="months-wrap">
                        <input
                          className="cell mon" inputMode="numeric" aria-label="납부한 할부개월수"
                          value={r.paid ?? ''}
                          onChange={e => onPatch(r.id, { paid: Number(e.target.value.replace(/\D/g, '')) || undefined })}
                        />
                        <span>/</span>
                        <input
                          className="cell mon" inputMode="numeric" aria-label="총 할부개월수"
                          value={r.months ?? ''}
                          onChange={e => {
                            const m = Number(e.target.value.replace(/\D/g, '')) || undefined;
                            // 총액을 아는 할부만 월 납부액을 다시 계산한다 (엑셀에서 옮긴 행은 이미 월 납부액)
                            onPatch(r.id, m && r.totalAmount
                              ? { months: m, amount: monthly(r.totalAmount, m) }
                              : { months: m });
                          }}
                        />
                      </span>
                    )}
                  </td>
                  <td className="center">
                    <select className="cell mid" aria-label="소비주체" value={r.owner} onChange={e => {
                      const o = e.target.value as Owner;
                      // 공통·일호회사로 바꾸면 개인 입금은 의미가 없어진다
                      onPatch(r.id, isPersonal(o) ? { owner: o } : { owner: o, deposit: 'N', depositAmount: undefined });
                    }}>
                      {OWNERS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </td>
                  <td className="center">
                    {personal ? (
                      <select className="cell mid" aria-label="개인 입금" value={r.deposit} onChange={e => {
                        const v = e.target.value as 'Y' | 'N';
                        onPatch(r.id, v === 'N' ? { deposit: v, depositAmount: undefined } : { deposit: v });
                      }}>
                        <option>N</option>
                        <option>Y</option>
                      </select>
                    ) : 'N'}
                  </td>
                  <td className="num">
                    {personal && r.deposit === 'Y' ? (
                      <input
                        className="cell right" inputMode="numeric" placeholder="0" aria-label="입금금액"
                        value={r.depositAmount ? r.depositAmount.toLocaleString('ko-KR') : ''}
                        onChange={e => onPatch(r.id, { depositAmount: toWon(e.target.value) || undefined })}
                      />
                    ) : ''}
                  </td>
                  <td>
                    <input
                      className="cell" aria-label="소비상세" placeholder="—"
                      value={r.detail ?? ''}
                      onChange={e => onPatch(r.id, { detail: e.target.value || undefined })}
                    />
                  </td>
                  <td><button type="button" className="ghost" onClick={() => onRemove(r.id)} aria-label="삭제">✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer>
        <span>{name} 일시불 합계 <b>{fmtWon(lumpTotal(rows))}</b></span>
        <span>{name} 총합계 (일시불+할부) <b>{fmtWon(cardTotal(rows))}</b></span>
      </footer>
    </section>
  );
}
