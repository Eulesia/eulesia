import { runStartupMigrations } from "../db/startupMigrations.js";

runStartupMigrations()
  .then(() => {
    console.log("Migrations OK");
  })
  .catch((error) => {
    console.error("Migration error:", error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
