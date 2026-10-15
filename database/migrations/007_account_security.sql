ALTER TABLE users ADD COLUMN webauthn_user_handle BINARY(32) NULL UNIQUE;

CREATE TABLE passkeys (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  credential_id VARBINARY(1024) NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
  name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE webauthn_challenges (
  token_digest BINARY(32) PRIMARY KEY,
  challenge VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  purpose ENUM('register','login') NOT NULL,
  browser_digest BINARY(32) NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  session_digest BINARY(32) NULL,
  expires_at DATETIME(3) NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX(expires_at)
) ENGINE=InnoDB;
