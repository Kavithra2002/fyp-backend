-- Run in DBeaver (DB_FYP connection). Run each block separately if you get errors.
-- 1) Creates the database (run first, only once):
CREATE DATABASE IF NOT EXISTS db_fyp
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- 2) Creates the users table (run after db_fyp exists). Uses db_fyp.users so no USE needed.
CREATE TABLE IF NOT EXISTS db_fyp.users (
  id            VARCHAR(36)  PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  password_plain VARCHAR(255) NULL,
  name          VARCHAR(255) NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
