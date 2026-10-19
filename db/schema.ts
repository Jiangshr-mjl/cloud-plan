import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A single-user snapshot makes bulk changes and optimistic concurrency atomic.
export const planner = sqliteTable("planner", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  tasks: text("tasks").notNull().default("[]"),
});
