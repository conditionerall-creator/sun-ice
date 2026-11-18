-- =====================================================================
-- 2026-11-18 — Позиції поза прайсом Excel (price_extras): серія MHI DXK-Z6-W1
-- =====================================================================
-- Навіщо. Власник: «Ціна на моделі DXK (модель не буде внесена в прайс)». Позиції треба
-- показати в «Спліт-системи / MHI» одразу після серії ZSPR, з дилерською ціною, і з
-- наявністю з 1С. У price.xlsx їх немає, тож опублікована версія (price_versions) їх не
-- має теж — вони живуть окремою таблицею і доливаються в ту саму відповідь get_price().
--
-- ЧОМУ НЕ В КОДІ ЗАСТОСУНКУ: файли застосунку лежать на GitHub і на app.sun-ice.com.ua
-- відкрито — дилерську ціну там прочитав би будь-хто. Тут ціну віддає лише get_price(),
-- тим самим правилом доступу, що й увесь прайс (profileAllowsPrices() у js/07-access-info.js).
-- Гість (get_price_public) отримує ті самі рядки БЕЗ ціни — як і решту прайсу.
--
-- Позначка "extra": true на кожній такій позиції — щоб звірка з Excel (самодіагностика) і
-- екран публікації прайсу (price-admin.js) не вважали їх «зайвими» / «зниклими».
--
-- Свіжість на телефоні: номер версії прайсу від цієї таблиці не залежить, тому всі чотири
-- функції віддають ще й extras_rev (кількість + найбільший id + час останньої зміни — без
-- цін: хеш від ціни можна було б підібрати перебором). Застосунок звіряє обидва.
--
-- ДВА КРОКИ. Цей файл (таблиця, функції, дані) нічого не міняє в тому, що бачать телефони:
-- get_price() його ще не викликає. Підключення — 2026-11-18-price-extras-get-price.sql, ОДНОЧАСНО з
-- заливкою застосунку, що вміє extras_rev (APP_BUILD ≥ 2026-11-18.3). Раніше — стара версія на сайті
-- отримала б DXK без назви групи, а екран публікації рахував би їх «зниклими».
--
-- ЗМІНА ЦІНИ: update public.price_extras set price = … where item->>'model' = '…';
-- (updated_at ставить тригер — extras_rev зміниться, телефони перекачають прайс).
-- =====================================================================

create table if not exists public.price_extras (
  id          bigserial primary key,
  sheet       text        not null,                 -- ключ розділу в даних прайсу: 'split_mhi'
  after_group text,                                 -- groupKey, ПІСЛЯ останньої позиції якого вставити; null/не знайдено → у кінець
  sort        integer     not null default 0,       -- порядок усередині вставки
  item        jsonb       not null,                 -- позиція БЕЗ ціни: model, splitOutdoor, unitType, groupKey, groupLabel, color…
  price       numeric     not null check (price > 0),
  currency    text        not null default '$',
  active      boolean     not null default true,
  note        text,                                 -- звідки ціна (для людей; застосунку не віддається)
  updated_at  timestamptz not null default now(),
  constraint price_extras_item_model check (coalesce(item->>'model', '') <> '')
);
create unique index if not exists price_extras_sheet_model on public.price_extras (sheet, (item->>'model'));

-- Таблицю напряму не читає ніхто: RLS увімкнено, політик немає. Доступ — лише через функції нижче.
alter table public.price_extras enable row level security;
revoke all on public.price_extras from anon, authenticated, public;
revoke all on sequence public.price_extras_id_seq from anon, authenticated, public;

create or replace function public.price_extras_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists price_extras_touch on public.price_extras;
create trigger price_extras_touch before update on public.price_extras
  for each row execute function public.price_extras_touch();

-- Мітка «чи змінились позиції поза прайсом». Без цін.
create or replace function public.price_extras_rev()
returns text language sql stable security definer set search_path to 'public' as $$
  select count(*)::text || ':' || coalesce(max(id), 0)::text || ':' ||
         coalesce(floor(extract(epoch from max(updated_at)) * 1000)::bigint, 0)::text
    from public.price_extras;
$$;

-- Вставка позицій у дані прайсу. Порядок прайсу не міняється: позиції стають ОДРАЗУ ПІСЛЯ
-- останньої позиції групи after_group (у split_mhi — після ZSPR), а якщо такої групи в
-- прайсі не виявилось (перейменували) — у кінець розділу, щоб їх не загубити.
create or replace function public.price_extras_merge(p_data jsonb, p_with_prices boolean)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_out jsonb := p_data;
  r record;
  v_arr jsonb; v_ins jsonb; v_pos integer; v_res jsonb;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return p_data; end if;
  for r in
    select sheet, after_group,
           jsonb_agg(
             e.item || jsonb_build_object('extra', true) ||
             case when p_with_prices then jsonb_build_object('price', e.price, 'currency', e.currency)
                  else '{}'::jsonb end
             order by e.sort, e.id) as items
      from public.price_extras e
     where e.active
     group by sheet, after_group
  loop
    v_arr := coalesce(v_out -> r.sheet, '[]'::jsonb);
    if jsonb_typeof(v_arr) <> 'array' then continue; end if;
    -- Позиція з такою самою моделлю вже є в прайсі (власник таки вніс її в Excel) — Excel головніший,
    -- дубль не доливаємо.
    select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_ins
      from jsonb_array_elements(r.items) with ordinality as t(x, o)
     where not exists (select 1 from jsonb_array_elements(v_arr) a where a->>'model' = x->>'model');
    if jsonb_array_length(v_ins) = 0 then continue; end if;
    select max(o) into v_pos
      from jsonb_array_elements(v_arr) with ordinality as t(x, o)
     where r.after_group is not null and x->>'groupKey' = r.after_group;
    if v_pos is null then v_pos := jsonb_array_length(v_arr); end if;
    select coalesce(jsonb_agg(x order by o), '[]'::jsonb) into v_res from (
      select x, o::numeric as o from jsonb_array_elements(v_arr) with ordinality as t(x, o)
      union all
      select x, v_pos + o::numeric / 10000 from jsonb_array_elements(v_ins) with ordinality as t(x, o)
    ) s;
    v_out := jsonb_set(v_out, array[r.sheet], v_res, true);
  end loop;
  return v_out;
end; $$;

revoke all on function public.price_extras_rev() from anon, authenticated, public;
revoke all on function public.price_extras_merge(jsonb, boolean) from anon, authenticated, public;

-- ---------- Дані: серія DXK-Z6-W1 (прайс власника 2026-11-18, колонка «дилер», $) ----------
-- Маркування — як у 1С і на sun-ice.com.ua (DXK09Z6-W1 / DXC09Z6-W1 …). Колір смуги — з палітри
-- PALETTE (js/02-price-parse.js), якого немає в сусідніх серій ZSPR і ZSP.
insert into public.price_extras (sheet, after_group, sort, item, price, currency, note) values
 ('split_mhi', 'ZSPR', 1, '{"model":"DXK09Z6-W1","splitOutdoor":"DXC09Z6-W1","unitType":"indoor","groupKey":"DXK","groupLabel":"Серія DXK-Z6-W1","groupNote":null,"groupFullText":null,"color":"#6B9E7F"}', 600,  '$', 'Btu 9 — дилер 600 $, розн. 700 $ (прайс власника 2026-11-18)'),
 ('split_mhi', 'ZSPR', 2, '{"model":"DXK12Z6-W1","splitOutdoor":"DXC12Z6-W1","unitType":"indoor","groupKey":"DXK","groupLabel":"Серія DXK-Z6-W1","groupNote":null,"groupFullText":null,"color":"#6B9E7F"}', 690,  '$', 'Btu 12 — дилер 690 $, розн. 800 $'),
 ('split_mhi', 'ZSPR', 3, '{"model":"DXK15Z6-W1","splitOutdoor":"DXC15Z6-W1","unitType":"indoor","groupKey":"DXK","groupLabel":"Серія DXK-Z6-W1","groupNote":null,"groupFullText":null,"color":"#6B9E7F"}', 980,  '$', 'Btu 15 — дилер 980 $, розн. 1140 $'),
 ('split_mhi', 'ZSPR', 4, '{"model":"DXK18Z6-W1","splitOutdoor":"DXC18Z6-W1","unitType":"indoor","groupKey":"DXK","groupLabel":"Серія DXK-Z6-W1","groupNote":null,"groupFullText":null,"color":"#6B9E7F"}', 1020, '$', 'Btu 18 — дилер 1020 $, розн. 1190 $')
on conflict (sheet, (item->>'model')) do nothing;
