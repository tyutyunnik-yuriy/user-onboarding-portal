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
  await client.connect();

  try {
    const emailDuplicates = await client.query(`
      select lower(email) as value, json_agg(full_name order by full_name) as employees
      from employees
      where email <> ''
      group by lower(email)
      having count(*) > 1
      order by lower(email)
    `);

    const phoneDuplicates = await client.query(`
      select regexp_replace(phone, '\\D', '', 'g') as value, json_agg(full_name order by full_name) as employees
      from employees
      where regexp_replace(phone, '\\D', '', 'g') <> ''
      group by regexp_replace(phone, '\\D', '', 'g')
      having count(*) > 1
      order by regexp_replace(phone, '\\D', '', 'g')
    `);

    if (emailDuplicates.rowCount === 0 && phoneDuplicates.rowCount === 0) {
      console.log("Дублей сотрудников по почте и телефону не найдено.");
      return;
    }

    if (emailDuplicates.rowCount > 0) {
      console.log("Дубли почты:");
      for (const row of emailDuplicates.rows) {
        console.log(`- ${row.value}: ${row.employees.join(", ")}`);
      }
    }

    if (phoneDuplicates.rowCount > 0) {
      console.log("Дубли телефонов:");
      for (const row of phoneDuplicates.rows) {
        console.log(`- ${row.value}: ${row.employees.join(", ")}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
