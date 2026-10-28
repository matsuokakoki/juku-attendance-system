CREATE TABLE attendance_templates(student_id TEXT NOT NULL REFERENCES students(id), weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 6), PRIMARY KEY(student_id,weekday,period));
CREATE TABLE template_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0);
INSERT INTO template_state(id,revision) VALUES(1,0);
INSERT INTO attendance_templates(student_id,weekday,period)
SELECT student_id,weekday,period FROM templates WHERE month=COALESCE((SELECT month FROM templates WHERE month=strftime('%Y-%m','now','+9 hours','start of month','+1 month') LIMIT 1),(SELECT MAX(month) FROM templates));
