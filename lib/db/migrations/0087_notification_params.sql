-- WhatsApp messages on events (lib/notify/whatsapp.ts): the template's parameters, in order, as they are sent.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS params jsonb;
