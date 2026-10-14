-- Logo is presentation-only; no policy epoch change or separate persistent file store.
UPDATE events
SET config = JSON_SET(config, '$.checkin_logo', NULL)
WHERE JSON_CONTAINS_PATH(config, 'one', '$.checkin_logo') = 0;
