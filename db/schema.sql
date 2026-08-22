create table if not exists employees (
  id text primary key,
  last_name text not null default '',
  first_name text not null default '',
  middle_name text not null default '',
  full_name text not null,
  email text not null unique,
  phone text not null default '',
  telegram_chat_id text not null default '',
  department text not null,
  subdivision text not null default '',
  position text not null,
  manager text not null,
  is_department_manager boolean not null default false,
  managed_subdivisions jsonb not null default '[]'::jsonb,
  access_level text not null default '',
  systems jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists requests (
  id text primary key,
  request_type text not null check (request_type in ('onboarding', 'offboarding', 'permissions')),
  status text not null check (status in ('new', 'in_progress', 'approved', 'rejected', 'done')),
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists request_history (
  id bigserial primary key,
  request_id text not null references requests(id) on delete cascade,
  status text not null check (status in ('new', 'in_progress', 'approved', 'rejected', 'done')),
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists dictionary_items (
  id text primary key,
  type text not null check (type in ('departments', 'positions', 'subdivisions', 'managers', 'accessLevels', 'systems')),
  value text not null,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, value)
);

alter table dictionary_items add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table dictionary_items drop constraint if exists dictionary_items_type_value_key;
alter table dictionary_items drop constraint if exists dictionary_items_type_check;
alter table dictionary_items add constraint dictionary_items_type_check check (type in ('departments', 'positions', 'subdivisions', 'managers', 'accessLevels', 'systems'));
alter table employees add column if not exists access_level text not null default '';
alter table employees add column if not exists systems jsonb not null default '[]'::jsonb;
alter table employees add column if not exists last_name text not null default '';
alter table employees add column if not exists first_name text not null default '';
alter table employees add column if not exists middle_name text not null default '';
alter table employees add column if not exists is_department_manager boolean not null default false;
alter table employees add column if not exists managed_subdivisions jsonb not null default '[]'::jsonb;
alter table employees add column if not exists subdivision text not null default '';
alter table employees add column if not exists telegram_chat_id text not null default '';

create index if not exists requests_created_at_idx on requests (created_at desc);
create index if not exists requests_status_idx on requests (status);
create index if not exists requests_type_idx on requests (request_type);
create index if not exists request_history_request_id_idx on request_history (request_id);
create index if not exists employees_status_idx on employees (status);
create index if not exists employees_department_idx on employees (department);
create index if not exists employees_subdivision_idx on employees (subdivision);
create index if not exists dictionary_items_type_idx on dictionary_items (type);
drop index if exists employees_phone_digits_unique_idx;
create index if not exists employees_phone_digits_idx
on employees ((regexp_replace(phone, '\D', '', 'g')))
where regexp_replace(phone, '\D', '', 'g') <> '';

alter table requests drop constraint if exists requests_request_type_check;
alter table requests add constraint requests_request_type_check check (request_type in ('onboarding', 'offboarding', 'permissions'));

insert into dictionary_items (id, type, value)
values
  ('dict-department-it', 'departments', 'ИТ'),
  ('dict-department-sales', 'departments', 'Продажи'),
  ('dict-department-accounting', 'departments', 'Бухгалтерия'),
  ('dict-subdivision-it', 'subdivisions', 'ИТ'),
  ('dict-subdivision-sales', 'subdivisions', 'Продажи'),
  ('dict-subdivision-accounting', 'subdivisions', 'Бухгалтерия'),
  ('dict-position-director', 'positions', 'Директор'),
  ('dict-position-manager', 'positions', 'Менеджер'),
  ('dict-position-client-manager', 'positions', 'Менеджер по работе с клиентами'),
  ('dict-position-accountant', 'positions', 'Бухгалтер'),
  ('dict-position-developer', 'positions', 'Программист'),
  ('dict-position-department-manager', 'positions', 'Руководитель отдела'),
  ('dict-manager-pisarevskiy', 'managers', 'Писаревский'),
  ('dict-manager-petr-ivanov', 'managers', 'Петр Иванов'),
  ('dict-manager-olga-melnik', 'managers', 'Ольга Мельник'),
  ('dict-access-basic', 'accessLevels', 'Базовый'),
  ('dict-access-extended', 'accessLevels', 'Расширенный'),
  ('dict-access-admin', 'accessLevels', 'Административный'),
  ('dict-system-email', 'systems', 'Корпоративная почта'),
  ('dict-system-crm', 'systems', 'CRM'),
  ('dict-system-erp', 'systems', 'ERP'),
  ('dict-system-vpn', 'systems', 'VPN'),
  ('dict-system-files', 'systems', 'Файловое хранилище')
on conflict (id) do nothing;

update dictionary_items
set metadata = '{"subdivisions":["ИТ","Продажи","Бухгалтерия"],"subdivision":"ИТ"}'::jsonb
where type = 'departments' and value = 'ИТ' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["Продажи"],"subdivision":"Продажи"}'::jsonb
where type = 'departments' and value = 'Продажи' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["Бухгалтерия"],"subdivision":"Бухгалтерия"}'::jsonb
where type = 'departments' and value = 'Бухгалтерия' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"phone":"+380501010101","subdivision":"ИТ"}'::jsonb
where type = 'managers' and value = 'Писаревский' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"phone":"+380502020202","subdivision":"Продажи"}'::jsonb
where type = 'managers' and value = 'Петр Иванов' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"phone":"+380503030303","subdivision":"Бухгалтерия"}'::jsonb
where type = 'managers' and value = 'Ольга Мельник' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"department":"ИТ"}'::jsonb
where type = 'positions' and value in ('Директор', 'Программист') and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"department":"Продажи"}'::jsonb
where type = 'positions' and value in ('Менеджер', 'Менеджер по работе с клиентами') and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"department":"Бухгалтерия"}'::jsonb
where type = 'positions' and value = 'Бухгалтер' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["ИТ","Продажи","Бухгалтерия"],"subdivision":"ИТ"}'::jsonb
where type = 'systems' and value = 'Корпоративная почта' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["Продажи"],"subdivision":"Продажи"}'::jsonb
where type = 'systems' and value = 'CRM' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["Бухгалтерия"],"subdivision":"Бухгалтерия"}'::jsonb
where type = 'systems' and value in ('ERP', 'Файловое хранилище') and metadata = '{}'::jsonb;

update dictionary_items
set metadata = '{"subdivisions":["ИТ"],"subdivision":"ИТ"}'::jsonb
where type = 'systems' and value = 'VPN' and metadata = '{}'::jsonb;

update dictionary_items
set metadata = jsonb_set(metadata, '{subdivisions}', jsonb_build_array(metadata->>'subdivision'))
where type = 'systems'
  and metadata ? 'subdivision'
  and not (metadata ? 'subdivisions');

with candidate_business_units(value) as (
  select subdivision
  from employees
  where subdivision <> ''
  union
  select jsonb_array_elements_text(managed_subdivisions)
  from employees
  where jsonb_typeof(managed_subdivisions) = 'array'
  union
  select payload->>'subdivision'
  from requests
  where payload ? 'subdivision' and coalesce(payload->>'subdivision', '') <> ''
  union
  select metadata->>'subdivision'
  from dictionary_items
  where metadata ? 'subdivision' and coalesce(metadata->>'subdivision', '') <> ''
  union
  select jsonb_array_elements_text(metadata->'subdivisions')
  from dictionary_items
  where metadata ? 'subdivisions' and jsonb_typeof(metadata->'subdivisions') = 'array'
)
insert into dictionary_items (id, type, value, status)
select
  'dict-subdivision-recovered-' || md5(trim(value)),
  'subdivisions',
  trim(value),
  'active'
from candidate_business_units
where trim(value) <> ''
  and not exists (
    select 1
    from dictionary_items existing
    where existing.type = 'subdivisions'
      and lower(existing.value) = lower(trim(candidate_business_units.value))
  )
on conflict (id) do nothing;

update employees
set last_name = split_part(full_name, ' ', 1),
    first_name = split_part(full_name, ' ', 2),
    middle_name = split_part(full_name, ' ', 3)
where last_name = '' and first_name = '' and full_name <> '';

update employees
set middle_name = ''
where middle_name is null;

update employees
set subdivision = department
where subdivision = '';

insert into employees (id, last_name, first_name, middle_name, full_name, email, phone, telegram_chat_id, department, subdivision, position, manager, is_department_manager, access_level, systems, status)
values
  ('emp-001', 'Иванов', 'Иван', '', 'Иванов Иван', 'smk@smk.com', '12344567', '', 'ИТ', 'ИТ', 'Директор', 'Писаревский', false, 'Административный', '["Корпоративная почта","CRM","ERP","VPN"]'::jsonb, 'active'),
  ('emp-002', 'Сергеева', 'Анна', '', 'Сергеева Анна', 'anna.sergeeva@example.com', '+380501112233', '', 'Продажи', 'Продажи', 'Менеджер по работе с клиентами', 'Петр Иванов', false, 'Базовый', '["Корпоративная почта","CRM"]'::jsonb, 'dismissed'),
  ('emp-003', 'Коваленко', 'Ирина', '', 'Коваленко Ирина', 'irina.kovalenko@example.com', '+380671234567', '', 'Бухгалтерия', 'Бухгалтерия', 'Бухгалтер', 'Ольга Мельник', false, 'Расширенный', '["Корпоративная почта","ERP","Файловое хранилище"]'::jsonb, 'active'),
  ('emp-manager-pisarevskiy', 'Писаревский', '', '', 'Писаревский', 'pisarevskiy@example.com', '+380501010101', '', 'ИТ', 'ИТ', 'Директор', 'Писаревский', true, 'Административный', '["Корпоративная почта","CRM","ERP","VPN"]'::jsonb, 'active'),
  ('emp-manager-petr-ivanov', 'Иванов', 'Петр', '', 'Иванов Петр', 'petr.ivanov@example.com', '+380502020202', '', 'Продажи', 'Продажи', 'Директор', 'Писаревский', true, 'Административный', '["Корпоративная почта","CRM"]'::jsonb, 'active'),
  ('emp-manager-olga-melnik', 'Мельник', 'Ольга', '', 'Мельник Ольга', 'olga.melnik@example.com', '+380503030303', '', 'Бухгалтерия', 'Бухгалтерия', 'Директор', 'Писаревский', true, 'Административный', '["Корпоративная почта","ERP","Файловое хранилище"]'::jsonb, 'active')
on conflict (id) do nothing;

update employees
set is_department_manager = true
where full_name in ('Писаревский', 'Петр Иванов', 'Иванов Петр', 'Ольга Мельник', 'Мельник Ольга');

update employees
set managed_subdivisions = jsonb_build_array(subdivision)
where is_department_manager = true
  and managed_subdivisions = '[]'::jsonb
  and subdivision <> '';

update employees
set access_level = 'Административный',
    systems = '["Корпоративная почта","CRM","ERP","VPN"]'::jsonb
where id = 'emp-001' and systems = '[]'::jsonb;

update employees
set access_level = 'Расширенный',
    systems = '["Корпоративная почта","ERP","Файловое хранилище"]'::jsonb
where id = 'emp-003' and systems = '[]'::jsonb;

update employees e
set access_level = coalesce(nullif(e.access_level, ''), r.payload->>'accessLevel', ''),
    systems = case
      when e.systems = '[]'::jsonb and jsonb_typeof(r.payload->'systems') = 'array' then r.payload->'systems'
      else e.systems
    end,
    last_name = coalesce(nullif(e.last_name, ''), r.payload->>'lastName', split_part(r.payload->>'fullName', ' ', 1), ''),
    first_name = coalesce(nullif(e.first_name, ''), r.payload->>'firstName', split_part(r.payload->>'fullName', ' ', 2), ''),
    middle_name = coalesce(nullif(e.middle_name, ''), r.payload->>'middleName', split_part(r.payload->>'fullName', ' ', 3), ''),
    updated_at = now()
from requests r
where r.request_type = 'onboarding'
  and r.status = 'done'
  and lower(e.email) = lower(r.payload->>'email');
