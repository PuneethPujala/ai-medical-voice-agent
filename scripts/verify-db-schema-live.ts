import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env" });
}

async function checkLiveDatabase() {
  console.log("Connecting to Neon PostgreSQL datastore...");
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in environment");
  }

  const sql = neon(process.env.DATABASE_URL);

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    ORDER BY table_name;
  `;
  console.log("\n=== ALL PUBLIC TABLES IN NEON DB ===");
  console.table(tables);

  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'consultations' 
    ORDER BY ordinal_position;
  `;

  console.log("\n=== NEON DB 'consultations' TABLE SCHEMA ===");
  console.table(cols);

  const auditCols = await sql`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'audit_events' 
    ORDER BY ordinal_position;
  `;
  console.log("\n=== NEON DB 'audit_events' TABLE SCHEMA ===");
  console.table(auditCols);

  const auditCount = await sql`
    SELECT count(*) as total_events FROM audit_events;
  `;
  console.log("\n=== TOTAL EVENTS IN 'audit_events' ===");
  console.table(auditCount);

  const rows = await sql`
    SELECT id, user_id, status, approved_at, approved_by, created_at 
    FROM consultations 
    ORDER BY created_at DESC 
    LIMIT 5;
  `;

  console.log("\n=== LIVE ROWS IN 'consultations' ===");
  console.table(rows);
}

checkLiveDatabase().catch((err) => {
  console.error("Database inspection failed:", err.message);
  process.exit(1);
});
