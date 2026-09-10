# ERHub

Painel colaborativo para gestão da sala de emergência, com pacientes ativos,
pendências, histórico, passagem de plantão e sincronização entre dispositivos.

## Arquitetura

- Frontend estático hospedado na Vercel.
- Autenticação por e-mail e senha no Supabase Auth.
- Banco PostgreSQL com isolamento por sala via Row Level Security (RLS).
- Atualizações em tempo real por Supabase Realtime.
- Histórico de alterações em `audit_log`.

O frontend usa somente a chave pública do Supabase. Nunca inclua uma chave
`service_role` ou secreta neste repositório.

## Uso seguro

Antes de cadastrar dados pessoais reais, realize a avaliação jurídica e de
segurança necessária para LGPD e para as regras da instituição de saúde.
