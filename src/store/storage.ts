// 저장 — books 테이블의 행 하나에 장부 전체가 들어간다. 리로·도리가 같은 행을 공유한다.
import { supabase } from '../lib/supabase';
import { emptyBook, type Book } from '../engine/types';

const ROW_ID = 'doriro';

const isBook = (v: unknown): v is Book => {
  const b = v as Book | null;
  return !!b && b.v === 1 && typeof b.months === 'object' && b.months !== null;
};

export async function loadBook(): Promise<Book> {
  const { data, error } = await supabase.from('books').select('data').eq('id', ROW_ID).maybeSingle();
  if (error) throw error;
  // RLS에 걸린 계정은 에러가 아니라 빈 결과를 받는다. 행은 SQL로 미리 만들어 뒀으니 없으면 권한이 없는 것
  if (!data) throw new Error('이 계정은 이 가계부를 볼 권한이 없습니다.');
  return isBook(data.data) ? data.data : emptyBook();
}

export async function saveBook(book: Book): Promise<void> {
  const { error } = await supabase.from('books').upsert({ id: ROW_ID, data: book });
  if (error) throw error;
}
