-- Run in DBeaver on db_fyp to add the password_plain column to existing users table.

ALTER TABLE db_fyp.users
  ADD COLUMN password_plain VARCHAR(255) NULL
  AFTER password_hash;
