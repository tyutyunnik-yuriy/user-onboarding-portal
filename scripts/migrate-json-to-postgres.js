const fs = require("node:fs/promises");
const path = require("node:path");

async function readJson(fileName) {
  const filePath = path.join(__dirname, "..", "data", fileName);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw || "[]");
}

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

  const users = await readJson("users.json");
  const requests = await readJson("requests.json");
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  await client.connect();
  await client.query("begin");

  try {
    const dictionaries = [
      ...uniqueValues(users.map((user) => user.department)).map((value) => ({ type: "departments", value })),
      ...uniqueValues(users.map((user) => user.department)).map((value) => ({ type: "subdivisions", value })),
      ...uniqueValues(users.map((user) => user.position)).map((value) => ({ type: "positions", value })),
      ...uniqueValues(users.map((user) => user.manager)).map((value) => ({
        type: "managers",
        value,
        metadata: { phone: "", subdivision: "" }
      }))
    ];

    for (const item of dictionaries) {
      await client.query(
        `
          insert into dictionary_items (id, type, value, metadata)
          values ($1, $2, $3, $4::jsonb)
          on conflict (type, value) do nothing
        `,
        [`dict-${item.type}-${slugify(item.value)}`, item.type, item.value, JSON.stringify(item.metadata || {})]
      );
    }

    for (const user of users) {
      const name = splitFullName(user.fullName);
      await client.query(
        `
          insert into employees (id, last_name, first_name, middle_name, full_name, email, phone, department, position, manager, is_department_manager, access_level, systems, status)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
          on conflict (id) do update
          set last_name = excluded.last_name,
              first_name = excluded.first_name,
              middle_name = excluded.middle_name,
              full_name = excluded.full_name,
              email = excluded.email,
              phone = excluded.phone,
              department = excluded.department,
              position = excluded.position,
              manager = excluded.manager,
              is_department_manager = excluded.is_department_manager,
              access_level = excluded.access_level,
              systems = excluded.systems,
              status = excluded.status,
              updated_at = now()
        `,
        [
          user.id,
          user.lastName || name.lastName,
          user.firstName || name.firstName,
          user.middleName || name.middleName,
          user.fullName,
          user.email,
          user.phone || "",
          user.department,
          user.position,
          user.manager,
          Boolean(user.isDepartmentManager),
          user.accessLevel || "",
          JSON.stringify(user.systems || []),
          user.status === "dismissed" ? "dismissed" : "active"
        ]
      );
    }

    for (const request of requests) {
      const payload = { ...request };
      delete payload.id;
      delete payload.status;
      delete payload.source;
      delete payload.createdAt;
      delete payload.updatedAt;
      delete payload.history;

      await client.query(
        `
          insert into requests (id, request_type, status, source, payload, created_at, updated_at)
          values ($1, $2, $3, $4, $5::jsonb, $6, $7)
          on conflict (id) do update
          set request_type = excluded.request_type,
              status = excluded.status,
              source = excluded.source,
              payload = excluded.payload,
              updated_at = excluded.updated_at
        `,
        [
          request.id,
          request.requestType || "onboarding",
          request.status || "new",
          request.source || "web",
          JSON.stringify(payload),
          request.createdAt || new Date().toISOString(),
          request.updatedAt || request.createdAt || new Date().toISOString()
        ]
      );

      await client.query("delete from request_history where request_id = $1", [request.id]);
      for (const event of request.history || []) {
        await client.query(
          "insert into request_history (request_id, status, note, created_at) values ($1, $2, $3, $4)",
          [request.id, event.status, event.note || "", event.at || request.createdAt || new Date().toISOString()]
        );
      }
    }

    await client.query("commit");
    console.log(`Migrated dictionary items: ${dictionaries.length}`);
    console.log(`Migrated employees: ${users.length}`);
    console.log(`Migrated requests: ${requests.length}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function splitFullName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    lastName: parts[0] || "",
    firstName: parts[1] || "",
    middleName: parts.slice(2).join(" ")
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
