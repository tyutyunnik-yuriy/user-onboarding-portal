function printPostgresHelp() {
  console.error("");
  console.error("PostgreSQL сейчас недоступен на localhost:5432.");
  console.error("");
  console.error("Запустите базу одним из вариантов:");
  console.error("");
  console.error("1. Через Docker из папки проекта:");
  console.error("   docker compose up -d postgres");
  console.error("");
  console.error("2. Если PostgreSQL установлен локально через Homebrew:");
  console.error("   brew services start postgresql@16");
  console.error("");
  console.error("После запуска базы повторите:");
  console.error("   ./bin/setup-db");
  console.error("   ./bin/start");
  console.error("");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Не задан DATABASE_URL.");
    process.exit(1);
  }

  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    console.error("Для PostgreSQL нужен пакет pg. Выполните: ./bin/install-deps");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query("select 1");
  } catch (error) {
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND" || error.errors) {
      printPostgresHelp();
      process.exit(1);
    }
    console.error(error.message || error);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
