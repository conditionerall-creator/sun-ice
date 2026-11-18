-- =====================================================================
-- 2026-11-18 — доступ до price.xlsx = доступ до цін
-- =====================================================================
-- Бакет `price` закрито 2026-11-11 (2026-10-19-close-price-bucket.sql). Але політика читання файлу
-- пускала будь-кого з профілем, крім 'blocked' — тобто й ВІДХИЛЕНИХ ('rejected') і тих, хто після
-- повторної реєстрації ще «на розгляді». get_price() їм цін не віддає, а файл із тими самими
-- дилерськими цінами вони могли скачати своєю сесією.
-- Тепер правило ДОСЛІВНО те саме, що в profileAllowsPrices() (js/07-access-info.js), get_price() і
-- get_stock(): є профіль, статус не 'blocked'/'rejected', і не (pending після повторної реєстрації).
-- Міняєш правило — міняй усі чотири місця.
-- Для дилерів нічого не змінюється: прайс вони беруть із get_price(), файл — лише аварійний шлях.
-- =====================================================================

drop policy if exists "price file for users with price access" on storage.objects;
create policy "price file for users with price access"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'price'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.status is not null
        and p.status not in ('blocked', 'rejected')
        and not (p.status = 'pending' and p.reregistered_at is not null)
    )
  );
