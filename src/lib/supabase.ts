// Supabase 클라이언트.
// 이 두 값은 번들에 그대로 실려 공개된다 — 접근 통제는 DB의 RLS 정책이 한다.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dlolqjgiamonfilfntxk.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_k9qS8EfKTJn2sWFI4F7Bcg_rJJac721';

export const supabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY);

/** 로그인 후 돌아올 주소 — 프로젝트 페이지로 옮겨도 그대로 동작하도록 pathname까지 붙인다 */
export const redirectTo = () => location.origin + location.pathname;
