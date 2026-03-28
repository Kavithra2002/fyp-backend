import { pool } from "../src/db.js";

export default async function teardown(): Promise<void> {
  await pool.end();
}
