create table if not exists gateway_orders (
  id text primary key,
  tilda_order_id text not null unique,
  pricpay_order_no text,
  creation_mode text not null,
  status text not null default 'created',
  transaction_amount numeric(18, 8),
  transaction_currency text,
  customer_email text,
  tilda_notify_url text,
  tilda_success_url text,
  tilda_failure_url text,
  tilda_pending_url text,
  pricpay_notify_url text,
  pricpay_return_url text,
  pricpay_redirect_url text,
  raw_tilda_order jsonb not null default '{}'::jsonb,
  pricpay_request jsonb,
  pricpay_response jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gateway_orders_pricpay_order_no_idx on gateway_orders (pricpay_order_no);
create index if not exists gateway_orders_status_idx on gateway_orders (status);
create index if not exists gateway_orders_created_at_idx on gateway_orders (created_at desc);

create table if not exists gateway_events (
  id text primary key,
  order_id text references gateway_orders (id) on delete set null,
  event_type text not null,
  direction text not null,
  endpoint text,
  http_method text,
  status_code integer,
  tilda_order_id text,
  pricpay_order_no text,
  request_body jsonb,
  response_body jsonb,
  signature_base text,
  signature_result text,
  redirect_url text,
  error_message text,
  created_at timestamptz not null default now()
);

alter table gateway_events add column if not exists order_id text references gateway_orders (id) on delete set null;
alter table gateway_events add column if not exists signature_base text;
alter table gateway_events add column if not exists signature_result text;

create index if not exists gateway_events_order_id_idx on gateway_events (order_id);
create index if not exists gateway_events_event_type_idx on gateway_events (event_type);
create index if not exists gateway_events_tilda_order_id_idx on gateway_events (tilda_order_id);
create index if not exists gateway_events_pricpay_order_no_idx on gateway_events (pricpay_order_no);
create index if not exists gateway_events_created_at_idx on gateway_events (created_at desc);

create table if not exists payment_notifications (
  id text primary key,
  order_id text references gateway_orders (id) on delete set null,
  platform_order_no text,
  tilda_order_id text,
  order_status text,
  amount numeric(18, 8),
  currency text,
  verified boolean not null default false,
  forwarded_to_tilda boolean not null default false,
  tilda_response_status integer,
  raw_body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_notifications_order_id_idx on payment_notifications (order_id);
create index if not exists payment_notifications_platform_order_no_idx on payment_notifications (platform_order_no);
create index if not exists payment_notifications_tilda_order_id_idx on payment_notifications (tilda_order_id);
create index if not exists payment_notifications_created_at_idx on payment_notifications (created_at desc);
