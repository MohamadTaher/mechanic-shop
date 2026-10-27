CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE closed_dates (
  date TEXT PRIMARY KEY,
  reason TEXT
);

CREATE TABLE appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  car TEXT NOT NULL,
  service TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_appointments_slot ON appointments (date, time, status);

INSERT INTO settings (key, value) VALUES (
  'schedule',
  '{"slotMinutes":60,"capacity":1,"daysAhead":21,"minNoticeHours":2,"week":{"0":{"open":false,"start":"09:00","end":"17:00"},"1":{"open":true,"start":"08:00","end":"17:00"},"2":{"open":true,"start":"08:00","end":"17:00"},"3":{"open":true,"start":"08:00","end":"17:00"},"4":{"open":true,"start":"08:00","end":"17:00"},"5":{"open":true,"start":"08:00","end":"17:00"},"6":{"open":true,"start":"09:00","end":"13:00"}}}'
);

INSERT INTO settings (key, value) VALUES (
  'shop',
  '{"name":"Mechanic Shop","phone":"","address":"","about":"Honest, friendly car repair."}'
);
