-- Existing activities retain their original opening time. JSON defaults also cover old snapshots.
UPDATE events
SET config = JSON_SET(config, '$.checkin_early_minutes', 0)
WHERE JSON_CONTAINS_PATH(config, 'one', '$.checkin_early_minutes') = 0;
