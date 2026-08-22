const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Задайте DATABASE_URL");
  }

  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    throw new Error("Для PostgreSQL нужен пакет pg. Выполните: ./bin/install-deps");
  }

  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const sql = await fs.readFile(schemaPath, "utf8");
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  try {
    await client.query(sql);
    console.log("PostgreSQL schema applied");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
