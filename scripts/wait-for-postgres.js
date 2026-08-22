const { setTimeout: wait } = require("node:timers/promises");

async function canConnect() {
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
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Не задан DATABASE_URL.");
    process.exit(1);
  }

  const attempts = Number(process.env.POSTGRES_WAIT_ATTEMPTS || 30);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await canConnect()) {
      console.log("PostgreSQL готов");
      return;
    }
    if (attempt === 1) console.log("Ждем, пока PostgreSQL запустится...");
    await wait(1000);
  }

  console.error("PostgreSQL не успел запуститься. Попробуйте повторить: ./bin/setup-db");
  process.exit(1);
}

main();
