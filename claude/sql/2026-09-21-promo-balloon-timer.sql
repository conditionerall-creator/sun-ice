-- ============================================================================
-- Sun-ice · 2026-09-21 · Кулька «Цікава новина»: власний таймер + збереження
-- ============================================================================
-- ПРОБЛЕМА, ЯКУ ЛАГОДИМО
--   Застосунок намагався записати promo_ack_id / promo_last_nag_at прямо в
--   profiles. Але в profiles НЕМАЄ політики, яка дозволяє людині оновити власний
--   рядок (є лише для regional_admin і super_admin). Перевірено на живій базі:
--   такий запит оновлював 0 рядків, помилки при цьому не було — supabase-js на
--   відфільтрований RLS-ом рядок помилку не кидає. Тобто галочка «Добре, буду мати
--   на увазі» не зберігалась НІКОЛИ, а серверний антиспам push не зсувався.
--
-- ЧОМУ НЕ ПРОСТО ДОДАТИ ПОЛІТИКУ «update ... using (auth.uid() = id)»
--   Це відкрило б діру: RLS обмежує РЯДКИ, а не КОЛОНКИ. Людина змогла б оновити
--   в своєму рядку будь-що — зокрема status. Заблокований користувач поставив би
--   собі 'approved' і повернув доступ до цін. Тригер trg_prevent_role_region_change
--   стереже тільки role і region_id, status він не перевіряє.
--   Колонкові grant-и теж не рятують: вони діють на роль authenticated, у якій
--   і звичайні користувачі, і адміни — обмеживши одних, зламали б інших.
--   Тому правильний інструмент тут — вузька SECURITY DEFINER функція, яка вміє
--   змінити РІВНО дві потрібні колонки і рівно у власному рядку того, хто дзвонить.
--
-- НОВА КОЛОНКА promo_balloon_last_at
--   Окремий таймер саме для кульки всередині застосунку. Раніше кулька і серверна
--   розсилка push ділили одне поле promo_last_nag_at і збивали таймер одне одному.
--   Домовленість із користувачем 2026-09-21: кулька повертається через 5 днів
--   навіть після галочки, а push лишається як був (галочка = тиша). Розвести їх у
--   різні поля — єдиний спосіб зробити це, не чіпаючи Edge Function send-promo-push.
--   promo_last_nag_at лишається ВИКЛЮЧНО за розсилкою push, застосунок його більше
--   не торкається.
--
-- БЕЗПЕЧНО ПЕРЕЗАПУСКАТИ.
-- ============================================================================

alter table public.profiles add column if not exists promo_balloon_last_at timestamptz;

comment on column public.profiles.promo_balloon_last_at is
  'Коли користувачеві востаннє показували кульку "Цікава новина" в застосунку. '
  'Окремо від promo_last_nag_at, яким керує розсилка push (send-promo-push).';

-- Єдиний дозволений для користувача спосіб торкнутися власного профілю.
-- p_ack_id      — id акції, яку людина підтвердила галочкою (null = не чіпати);
-- p_touch_balloon — true, коли кульку щойно показали (ставить поточний час).
create or replace function public.mark_promo_seen(p_ack_id bigint, p_touch_balloon boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'mark_promo_seen: потрібен вхід у застосунок';
  end if;
  update public.profiles
     set promo_ack_id = coalesce(p_ack_id, promo_ack_id),
         promo_balloon_last_at = case
           when coalesce(p_touch_balloon, false) then now()
           else promo_balloon_last_at
         end
   where id = auth.uid();
end;
$$;

-- Гостям тут робити нічого: у них немає профілю, стан кульки живе в localStorage.
revoke execute on function public.mark_promo_seen(bigint, boolean) from anon, public;
grant execute on function public.mark_promo_seen(bigint, boolean) to authenticated;
