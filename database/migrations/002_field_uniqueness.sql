CREATE TABLE IF NOT EXISTS checkin_field_values (
  event_id BIGINT UNSIGNED NOT NULL,
  field_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_digest BINARY(32) NOT NULL,
  checkin_id BIGINT UNSIGNED NOT NULL,
  UNIQUE KEY unique_field_value (event_id, field_key, value_digest),
  KEY checkin_value_owner (checkin_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (checkin_id) REFERENCES checkins(id) ON DELETE CASCADE
) ENGINE=InnoDB;
