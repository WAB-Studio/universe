import { pgSchema } from "drizzle-orm/pg-core";

// Every table this app owns lives here, beside orbit's `finances`
// (apps/orbit/db/schema/_schema.ts) and voyager's `reading` — same database,
// three schemas, one migration journal each.
export const goalsSchema = pgSchema("goals");
