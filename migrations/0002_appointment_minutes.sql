-- Length of each appointment at the time it was booked, so later length changes cannot double-book.
ALTER TABLE appointments ADD COLUMN minutes INTEGER NOT NULL DEFAULT 60;
