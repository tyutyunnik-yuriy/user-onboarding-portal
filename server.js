const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const storage = require("./storage/postgresStorage");
const { validateStatusTransition } = require("./services/statusWorkflow");

const PORT = Number(process.env.PORT || 3002);
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const UNSAFE_ADMIN_PASSWORDS = new Set(["admin123", "change-me-before-publication", "change-this"]);
const DEPARTMENT_MANAGER_POSITION = "Руководитель отдела";
const MAX_JSON_BODY_BYTES = 1_000_000;
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

const requestTypes = {
  onboarding: "Подключение",
  offboarding: "Увольнение",
  permissions: "Изменение прав"
};

const requiredFieldsByType = {
  onboarding: ["lastName", "firstName", "email", "phone", "department", "subdivision", "position", "manager", "startDate", "accessLevel", "systems"],
  offboarding: ["employeeId", "terminationDate", "disableTime", "handoverTo"],
  permissions: ["employeeId"]
};

const fieldLabels = {
  requestType: "Тип заявки",
  fullName: "ФИО",
  lastName: "Фамилия",
  firstName: "Имя",
  middleName: "Отчество",
  email: "Рабочая почта",
  phone: "Телефон",
  department: "Отдел",
  subdivision: "Бизнес-юнит",
  position: "Должность",
  manager: "Руководитель",
  startDate: "Дата начала работы",
  accessLevel: "Уровень доступа",
  systems: "Необходимые системы",
  employeeId: "Сотрудник из базы",
  employeeName: "ФИО увольняемого сотрудника",
  employeeEmail: "Почта увольняемого сотрудника",
  terminationDate: "Дата увольнения",
  disableTime: "Когда отключить доступы",
  handoverTo: "Кому передать данные",
  offboardingActions: "Что отключить или передать",
  currentSystems: "Текущие системы",
  systemsToAdd: "Системы для добавления",
  systemsToRemove: "Системы для удаления",
  requestedSystems: "Итоговый список систем",
  requestedAccessLevel: "Новый уровень доступа",
  comment: "Комментарий"
};

const sessions = new Map();
let telegramOffset = 0;

const dictionaryTypes = {
  departments: "Отделы",
  positions: "Должности",
  subdivisions: "Бизнес-юниты",
  managers: "Руководители",
  accessLevels: "Уровни доступа",
  systems: "Системы"
};

const editableDictionaryTypes = {
  departments: dictionaryTypes.departments,
  positions: dictionaryTypes.positions,
  subdivisions: dictionaryTypes.subdivisions,
  accessLevels: dictionaryTypes.accessLevels,
  systems: dictionaryTypes.systems
};

function splitFullName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return {
    lastName: parts[0] || "",
    firstName: parts[1] || "",
    middleName: parts.slice(2).join(" ")
  };
}

function buildFullName({ lastName = "", firstName = "", middleName = "", fullName = "" }) {
  const structured = [lastName, firstName, middleName].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  return structured || String(fullName || "").trim();
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value = "") {
  return String(value || "")
    .trim()
    .replace(/ё/g, "е")
    .toLowerCase();
}

function isValidUkrainianPhone(value = "") {
  return /^380\d{9}$/.test(normalizePhone(value));
}

function normalizeMetadataSubdivisions(metadata = {}) {
  const raw = Array.isArray(metadata.subdivisions)
    ? metadata.subdivisions
    : String(metadata.subdivisions || metadata.subdivision || "")
        .split(",")
        .map((item) => item.trim());
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function sameSubdivisions(leftMetadata = {}, rightMetadata = {}) {
  const left = normalizeMetadataSubdivisions(leftMetadata).map((item) => item.toLowerCase()).sort();
  const right = normalizeMetadataSubdivisions(rightMetadata).map((item) => item.toLowerCase()).sort();
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function hasSubdivisionOverlap(leftMetadata = {}, rightMetadata = {}) {
  const left = normalizeMetadataSubdivisions(leftMetadata).map((item) => item.toLowerCase());
  const right = normalizeMetadataSubdivisions(rightMetadata).map((item) => item.toLowerCase());
  if (left.length === 0 || right.length === 0) return true;
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function normalizeDictionaryItem(payload, existing = {}) {
  const type = editableDictionaryTypes[payload.type] ? payload.type : existing.type;
  const subdivisions = Array.isArray(payload.subdivisions)
    ? payload.subdivisions.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.subdivisions || payload.subdivision || payload.metadata?.subdivisions || payload.metadata?.subdivision || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const metadata =
    type === "positions"
      ? {
          ...(existing.metadata || {}),
          department: String(payload.department || payload.metadata?.department || "").trim()
        }
      : type === "systems" || type === "departments"
        ? {
            ...(existing.metadata || {}),
            subdivisions,
            subdivision: subdivisions[0] || ""
          }
        : {};

  return {
    id: existing.id || crypto.randomUUID(),
    type,
    value: String(payload.value || "").trim(),
    metadata,
    status: payload.status === "archived" ? "archived" : "active"
  };
}

function validateDictionaryItem(item, allItems, currentId = "") {
  const errors = [];
  if (!editableDictionaryTypes[item.type]) errors.push("Этот справочник редактируется в другом разделе");
  if (!item.value) errors.push("Значение справочника обязательно");
  if (item.type === "positions" && !item.metadata.department) {
    errors.push('Для должности нужно выбрать отдел');
  }
  if (item.type === "systems" && !normalizeMetadataSubdivisions(item.metadata).length) {
    errors.push('Для системы нужно выбрать хотя бы один бизнес-юнит');
  }
  if (item.type === "departments" && !normalizeMetadataSubdivisions(item.metadata).length) {
    errors.push('Для отдела нужно выбрать хотя бы один бизнес-юнит');
  }

  const duplicate = allItems.find(
    (existing) =>
      existing.id !== currentId &&
      existing.type === item.type &&
      existing.value.toLowerCase() === item.value.toLowerCase() &&
      (item.type !== "positions" ||
        String(existing.metadata?.department || "").toLowerCase() === String(item.metadata?.department || "").toLowerCase()) &&
      (item.type !== "systems" ||
        sameSubdivisions(existing.metadata, item.metadata) ||
        hasSubdivisionOverlap(existing.metadata, item.metadata)) &&
      (item.type !== "departments" ||
        sameSubdivisions(existing.metadata, item.metadata) ||
        hasSubdivisionOverlap(existing.metadata, item.metadata))
  );
  if (duplicate) errors.push("Такое значение уже есть в справочнике");

  return errors;
}

function normalizeUser(payload, existing = {}) {
  const systems = Array.isArray(payload.systems)
    ? payload.systems.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.systems || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const managedSubdivisions = Array.isArray(payload.managedSubdivisions)
    ? payload.managedSubdivisions.map((item) => String(item).trim()).filter(Boolean)
    : Array.isArray(payload.subdivisions)
      ? payload.subdivisions.map((item) => String(item).trim()).filter(Boolean)
      : String(payload.managedSubdivisions || payload.subdivisions || existing.managedSubdivisions || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

  const fallbackName = splitFullName(payload.fullName || existing.fullName || "");
  const lastName = String(payload.lastName ?? existing.lastName ?? fallbackName.lastName).trim();
  const firstName = String(payload.firstName ?? existing.firstName ?? fallbackName.firstName).trim();
  const middleName = String(payload.middleName ?? existing.middleName ?? fallbackName.middleName).trim();

  const isDepartmentManager = payload.isDepartmentManager === "on" || payload.isDepartmentManager === true;

  return {
    id: existing.id || crypto.randomUUID(),
    lastName,
    firstName,
    middleName,
    fullName: buildFullName({ lastName, firstName, middleName, fullName: payload.fullName || existing.fullName }),
    email: String(payload.email || "").trim(),
    phone: String(payload.phone || "").trim(),
    telegramChatId: String(payload.telegramChatId || "").trim(),
    department: String(payload.department || "").trim(),
    subdivision: String(payload.subdivision || existing.subdivision || payload.department || "").trim(),
    position: isDepartmentManager ? DEPARTMENT_MANAGER_POSITION : String(payload.position || "").trim(),
    manager: String(payload.manager || "").trim(),
    isDepartmentManager,
    managedSubdivisions,
    accessLevel: String(payload.accessLevel || "").trim(),
    systems,
    status: payload.status === "dismissed" ? "dismissed" : "active"
  };
}

function validateUser(user, users, currentId = "", existingUser = null) {
  const required = ["lastName", "firstName", "email", "department", "position"];
  const labels = {
    lastName: "Фамилия",
    firstName: "Имя",
    email: "Почта",
    department: "Отдел",
    position: "Должность",
    manager: "Руководитель"
  };
  const errors = required.filter((field) => !user[field]).map((field) => `Поле "${labels[field]}" обязательно`);
  if (!user.isDepartmentManager && !user.manager) {
    errors.push('Поле "Руководитель" обязательно');
  }
  if (user.isDepartmentManager && user.managedSubdivisions.length === 0) {
    errors.push('Для руководителя нужно выбрать хотя бы один бизнес-юнит');
  }

  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
    errors.push("Укажите корректную почту сотрудника");
  }

  if (user.phone && !isValidUkrainianPhone(user.phone)) {
    errors.push("Укажите телефон в полном формате +38 (0XX) XXX-XX-XX");
  }

  const normalizedEmail = normalizeEmail(user.email);
  const existingEmail = normalizeEmail(existingUser?.email || "");
  const emailChanged = !existingUser || normalizedEmail !== existingEmail;
  const isCurrentUser = (item) => String(item.id || "") === String(currentId || "");
  const duplicateEmail = emailChanged ? users.find((item) => !isCurrentUser(item) && normalizeEmail(item.email) === normalizedEmail) : null;
  if (duplicateEmail) {
    errors.push("Сотрудник с такой почтой уже есть в базе");
  }

  const normalizedPhone = normalizePhone(user.phone);
  const existingPhone = normalizePhone(existingUser?.phone || "");
  const phoneChanged = !existingUser || normalizedPhone !== existingPhone;
  const duplicatePhone = normalizedPhone && phoneChanged
    ? users.find((item) => !isCurrentUser(item) && normalizePhone(item.phone) === normalizedPhone)
    : null;
  if (duplicatePhone) {
    errors.push("Сотрудник с таким телефоном уже есть в базе");
  }

  return errors;
}

async function applyCompletedRequestEffects(item) {
  if (item.status !== "done") return [];

  if (item.requestType === "onboarding") {
    const existing = item.email ? await storage.findUserByEmail(item.email) : null;
    const user = {
      id: existing?.id || crypto.randomUUID(),
      lastName: item.lastName,
      firstName: item.firstName,
      middleName: item.middleName,
      fullName: item.fullName,
      email: item.email,
      phone: item.phone || "",
      department: item.department,
      subdivision: item.subdivision || item.department || "",
      position: item.position,
      manager: item.manager,
      isDepartmentManager: Boolean(item.isDepartmentManager),
      managedSubdivisions: existing?.managedSubdivisions || [],
      accessLevel: item.accessLevel,
      systems: item.systems || [],
      status: "active"
    };

    const users = await storage.listUsers({ includeDismissed: true });
    const errors = validateUser(user, users, existing?.id || "", existing);
    if (errors.length) return [`Сотрудник не создан: ${errors.join(". ")}`];

    if (existing) {
      await storage.updateUser(existing.id, user);
      return ["Сотрудник обновлен в базе"];
    }

    await storage.createUser(user);
    return ["Сотрудник добавлен в базу"];
  }

  if (item.requestType === "offboarding") {
    const users = await storage.listUsers({ includeDismissed: true });
    const existing = users.find((user) => {
      if (item.employeeId && user.id === item.employeeId) return true;
      return item.employeeEmail && user.email.toLowerCase() === item.employeeEmail.toLowerCase();
    });

    if (!existing) return ["Сотрудник для увольнения не найден в базе"];
    if (existing.status === "dismissed") return ["Сотрудник уже отмечен уволенным"];

    await storage.updateUser(existing.id, { ...existing, status: "dismissed" });
    return ["Сотрудник отмечен уволенным"];
  }

  if (item.requestType === "permissions") {
    const users = await storage.listUsers({ includeDismissed: true });
    const existing = users.find((user) => user.id === item.employeeId);
    if (!existing) return ["Сотрудник для изменения прав не найден в базе"];

    const currentSystems = new Set(existing.systems || []);
    for (const system of item.systemsToRemove || []) currentSystems.delete(system);
    for (const system of item.systemsToAdd || []) currentSystems.add(system);

    await storage.updateUser(existing.id, {
      ...existing,
      accessLevel: item.requestedAccessLevel || existing.accessLevel,
      systems: [...currentSystems],
      status: "active"
    });
    return ["Права сотрудника обновлены"];
  }

  return [];
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const [key, ...value] = part.trim().split("=");
        try {
          return [key, decodeURIComponent(value.join("="))];
        } catch {
          return [key, value.join("=")];
        }
      })
  );
}

function getSession(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  if (getSession(req)) return true;
  sendJson(res, 401, { error: "Требуется вход администратора" });
  return false;
}

function cookieFlags(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const isSecure = req.socket.encrypted || forwardedProto === "https";
  return `HttpOnly; SameSite=Lax; Path=/${isSecure ? "; Secure" : ""}`;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BODY_BYTES) {
      throw httpError(413, "Слишком большой запрос");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "Некорректный JSON в запросе");
  }
}

function normalizeRequest(payload, source) {
  const requestType = requestTypes[payload.requestType] ? payload.requestType : "onboarding";
  const systems = Array.isArray(payload.systems)
    ? payload.systems.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.systems || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const offboardingActions = Array.isArray(payload.offboardingActions)
    ? payload.offboardingActions.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.offboardingActions || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const systemsToAdd = Array.isArray(payload.systemsToAdd)
    ? payload.systemsToAdd.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.systemsToAdd || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const systemsToRemove = Array.isArray(payload.systemsToRemove)
    ? payload.systemsToRemove.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.systemsToRemove || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const requestedSystems = Array.isArray(payload.requestedSystems)
    ? payload.requestedSystems.map((item) => String(item).trim()).filter(Boolean)
    : String(payload.requestedSystems || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const fallbackName = splitFullName(payload.fullName || "");
  const lastName = String(payload.lastName || fallbackName.lastName || "").trim();
  const firstName = String(payload.firstName || fallbackName.firstName || "").trim();
  const middleName = String(payload.middleName || fallbackName.middleName || "").trim();

  return {
    requestType,
    lastName,
    firstName,
    middleName,
    fullName: buildFullName({ lastName, firstName, middleName, fullName: payload.fullName }),
    email: String(payload.email || "").trim(),
    phone: String(payload.phone || "").trim(),
    department: String(payload.department || "").trim(),
    subdivision: String(payload.subdivision || payload.department || "").trim(),
    position: String(payload.position || "").trim(),
    manager: String(payload.manager || "").trim(),
    managerEmployeeId: String(payload.managerEmployeeId || "").trim(),
    managerTelegramChatId: String(payload.managerTelegramChatId || "").trim(),
    startDate: String(payload.startDate || "").trim(),
    accessLevel: String(payload.accessLevel || "").trim(),
    currentAccessLevel: String(payload.currentAccessLevel || "").trim(),
    requestedAccessLevel: String(payload.requestedAccessLevel || "").trim(),
    systems,
    currentSystems: Array.isArray(payload.currentSystems) ? payload.currentSystems : [],
    requestedSystems,
    systemsToAdd,
    systemsToRemove,
    employeeId: String(payload.employeeId || "").trim(),
    employeeName: String(payload.employeeName || "").trim(),
    employeeEmail: String(payload.employeeEmail || "").trim(),
    terminationDate: String(payload.terminationDate || "").trim(),
    disableTime: String(payload.disableTime || "").trim(),
    handoverTo: String(payload.handoverTo || "").trim(),
    offboardingActions,
    comment: String(payload.comment || "").trim(),
    source
  };
}

async function findDepartmentManager({ subdivision = "", department = "", managerName = "" } = {}) {
  const normalizedSubdivision = String(subdivision || "").trim().toLowerCase();
  const normalizedDepartment = String(department || "").trim().toLowerCase();
  const normalizedManager = String(managerName || "").trim().toLowerCase();
  if (!normalizedSubdivision || !normalizedDepartment) return null;

  const users = await storage.listUsers();
  const managers = users.filter((user) => user.isDepartmentManager);
  const matchesBusinessUnit = (user) => {
    const managed = (user.managedSubdivisions || []).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
    return (
      managed.includes(normalizedSubdivision) ||
      (user.subdivision || "").toLowerCase() === normalizedSubdivision
    );
  };
  const matchesDepartment = (user) => (user.department || "").toLowerCase() === normalizedDepartment;

  return (
    managers.find((user) => normalizedManager && user.fullName.toLowerCase() === normalizedManager && matchesBusinessUnit(user) && matchesDepartment(user)) ||
    managers.find((user) => matchesBusinessUnit(user) && matchesDepartment(user)) ||
    null
  );
}

async function validatePositionForDepartment(item) {
  if (!item.department || !item.position) return "";
  const dictionaries = await storage.listDictionaries();
  const normalizedDepartment = item.department.toLowerCase();
  const positions = (dictionaries.positions || []).filter((entry) => entry.value.toLowerCase() === item.position.toLowerCase());
  if (positions.length === 0) return "";

  const allowed = positions.some((position) => {
    const positionDepartment = String(position.metadata?.department || "").trim().toLowerCase();
    return !positionDepartment || positionDepartment === normalizedDepartment;
  });
  if (!allowed) {
    return `Должность "${item.position}" не относится к отделу "${item.department}"`;
  }
  return "";
}

function systemsForSubdivision(dictionaries, subdivision) {
  const normalizedSubdivision = String(subdivision || "").trim().toLowerCase();
  return (dictionaries.systems || []).filter((entry) => {
    if (entry.status === "archived") return false;
    const systemSubdivisions = normalizeMetadataSubdivisions(entry.metadata).map((item) => item.toLowerCase());
    return systemSubdivisions.length === 0 || !normalizedSubdivision || systemSubdivisions.includes(normalizedSubdivision);
  });
}

async function validateSystemsForSubdivision(item) {
  const selectedSystems =
    item.requestType === "onboarding"
      ? item.systems || []
      : item.requestType === "permissions"
        ? item.systemsToAdd || []
        : [];
  if (selectedSystems.length === 0) return [];

  const subdivision = item.subdivision || item.department;
  const dictionaries = await storage.listDictionaries();
  const allowed = new Set(systemsForSubdivision(dictionaries, subdivision).map((entry) => entry.value));
  const unavailable = selectedSystems.filter((system) => !allowed.has(system));

  return unavailable.length
    ? [`Для бизнес-юнита "${subdivision || "не выбрано"}" недоступны системы: ${unavailable.join(", ")}`]
    : [];
}

async function validateNewEmployeeUniqueness(item) {
  if (item.requestType !== "onboarding") return [];
  const users = await storage.listUsers({ includeDismissed: true });
  const requests = await storage.listRequests();
  const errors = [];
  const normalizedEmail = normalizeEmail(item.email);
  const normalizedPhone = normalizePhone(item.phone);

  if (normalizedEmail && users.some((user) => normalizeEmail(user.email) === normalizedEmail)) {
    errors.push("Сотрудник с такой почтой уже есть в базе");
  }

  if (normalizedPhone && users.some((user) => normalizePhone(user.phone) === normalizedPhone)) {
    errors.push("Сотрудник с таким телефоном уже есть в базе");
  }

  const activeOnboardingRequests = requests.filter(
    (request) => request.requestType === "onboarding" && !["rejected", "done"].includes(request.status)
  );

  if (normalizedEmail && activeOnboardingRequests.some((request) => normalizeEmail(request.email) === normalizedEmail)) {
    errors.push("Заявка с такой почтой уже есть в работе");
  }

  if (normalizedPhone && activeOnboardingRequests.some((request) => normalizePhone(request.phone) === normalizedPhone)) {
    errors.push("Заявка с таким телефоном уже есть в работе");
  }

  return errors;
}

async function resolveActiveEmployee(item) {
  const users = await storage.listUsers();
  const query = normalizeText(item.employeeName || item.fullName);
  const email = normalizeEmail(item.employeeEmail || item.email);
  const matchesQuery = (user) => {
    if (!query) return true;
    const text = normalizeText([
      user.fullName,
      user.lastName,
      user.firstName,
      user.middleName,
      user.email,
      user.phone,
      user.department,
      user.subdivision,
      user.position
    ].join(" "));
    return query.split(/\s+/).every((token) => text.includes(token));
  };

  const validateProvidedIdentifiers = (employee) => {
    if (email && normalizeEmail(employee.email) !== email) {
      return ["ФИО и почта указывают на разных сотрудников. Выберите сотрудника из базы или уточните почту"];
    }
    if (query && !matchesQuery(employee)) {
      return ["ФИО и почта указывают на разных сотрудников. Выберите сотрудника из базы или уточните ФИО"];
    }
    return [];
  };

  if (item.employeeId) {
    const employee = await storage.findActiveUserById(item.employeeId);
    if (!employee) return { errors: ["Сотрудник не найден в базе или уже отключен"] };
    const identifierErrors = validateProvidedIdentifiers(employee);
    return identifierErrors.length ? { errors: identifierErrors } : { employee };
  }

  if (email) {
    const employee = users.find((user) => normalizeEmail(user.email) === email);
    if (!employee) return { errors: ["Активный сотрудник с такой почтой не найден"] };
    const identifierErrors = validateProvidedIdentifiers(employee);
    return identifierErrors.length ? { errors: identifierErrors } : { employee };
  }

  if (!query) return { employee: null };

  const matches = users.filter(matchesQuery);

  if (matches.length === 1) return { employee: matches[0] };
  if (matches.length > 1) {
    return { errors: ["Найдено несколько сотрудников. Уточните ФИО или почту сотрудника"] };
  }
  return { errors: ["Сотрудник не найден в базе"] };
}

function applyEmployeeSnapshot(item, employee) {
  item.fullName = "";
  item.email = "";
  item.phone = "";
  item.employeeId = employee.id;
  item.employeeName = employee.fullName;
  item.employeeEmail = employee.email;
  item.department = employee.department;
  item.subdivision = employee.subdivision || employee.department;
  item.position = employee.position || "";
  item.manager = employee.manager;
  item.currentAccessLevel = employee.accessLevel || "";
  item.currentSystems = employee.systems || [];
}

function validateRequest(item) {
  const requiredFields = requiredFieldsByType[item.requestType] || requiredFieldsByType.onboarding;
  const missing = requiredFields.filter((field) => {
    const value = item[field];
    return Array.isArray(value) ? value.length === 0 : !value;
  });

  const errors = missing.map((field) => `Поле "${fieldLabels[field]}" обязательно`);

  if (item.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) {
    errors.push("Укажите корректную рабочую почту");
  }

  if (item.employeeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.employeeEmail)) {
    errors.push("Укажите корректную почту увольняемого сотрудника");
  }

  if (item.requestType === "onboarding" && item.phone && !isValidUkrainianPhone(item.phone)) {
    errors.push("Укажите телефон в полном формате +38 (0XX) XXX-XX-XX");
  }

  if (item.startDate && Number.isNaN(Date.parse(item.startDate))) {
    errors.push("Укажите корректную дату начала работы");
  }

  if (item.terminationDate && Number.isNaN(Date.parse(item.terminationDate))) {
    errors.push("Укажите корректную дату увольнения");
  }

  return errors;
}

async function createRequest(payload, source = "web") {
  const normalized = normalizeRequest(payload, source);
  if (normalized.requestType === "offboarding") {
    const { employee, errors } = await resolveActiveEmployee(normalized);
    if (errors) return { errors };
    if (employee) applyEmployeeSnapshot(normalized, employee);
  }
  if (normalized.requestType === "permissions") {
    const { employee, errors } = await resolveActiveEmployee(normalized);
    if (errors) return { errors };
    if (employee) {
      applyEmployeeSnapshot(normalized, employee);
    }
    if (Object.hasOwn(payload, "requestedSystems")) {
      normalized.systemsToAdd = normalized.requestedSystems.filter((system) => !normalized.currentSystems.includes(system));
      normalized.systemsToRemove = normalized.currentSystems.filter((system) => !normalized.requestedSystems.includes(system));
    }
  }

  const manager = await findDepartmentManager({
    subdivision: normalized.subdivision,
    department: normalized.department,
    managerName: normalized.manager
  });
  if (manager) {
    normalized.manager = manager.fullName;
    normalized.managerEmployeeId = manager.id;
    normalized.managerTelegramChatId = manager.telegramChatId || "";
  }

  const errors = validateRequest(normalized);
  errors.push(...(await validateNewEmployeeUniqueness(normalized)));
  const positionError = await validatePositionForDepartment(normalized);
  if (positionError) errors.push(positionError);
  errors.push(...(await validateSystemsForSubdivision(normalized)));
  if (normalized.requestType === "permissions") {
    const accessChanged = normalized.requestedAccessLevel && normalized.requestedAccessLevel !== normalized.currentAccessLevel;
    if (!accessChanged && normalized.systemsToAdd.length === 0 && normalized.systemsToRemove.length === 0) {
      errors.push("Выберите, какие права нужно изменить");
    }
  }
  if (errors.length) return { errors };

  const now = new Date().toISOString();
  const item = {
    id: crypto.randomUUID(),
    status: "new",
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, status: "new", note: "Заявка создана" }],
    ...normalized
  };

  await storage.createRequest(item);
  notifyManagerForApproval(item).catch((error) => console.error("Telegram manager approval failed:", error.message));
  notifyAdmin(item).catch((error) => console.error("Telegram notify failed:", error.message));
  return { item };
}

async function listDictionariesWithManagers(options = {}) {
  const dictionaries = await storage.listDictionaries(options);
  const users = await storage.listUsers();
  dictionaries.managers = users
    .filter((user) => user.isDepartmentManager)
    .map((user) => ({
      id: `employee-manager-${user.id}`,
      type: "managers",
      value: user.fullName,
      metadata: {
        employeeId: user.id,
        phone: user.phone || "",
        department: user.department || "",
        subdivisions: user.managedSubdivisions?.length ? user.managedSubdivisions : [user.subdivision || user.department || ""].filter(Boolean),
        subdivision: user.subdivision || user.department || "",
        telegramChatId: user.telegramChatId || ""
      },
      status: "active"
    }));
  return dictionaries;
}

function requestApprovalText(item) {
  if (item.requestType === "offboarding") {
    return [
      "Заявка на согласование: увольнение",
      `Номер: ${item.id.slice(0, 8)}`,
      `Сотрудник: ${item.employeeName}`,
      `Почта: ${item.employeeEmail}`,
      `Отдел: ${item.department}`,
      `Дата увольнения: ${item.terminationDate}`,
      `Текущие системы: ${item.currentSystems?.join(", ") || item.offboardingActions?.join(", ") || "—"}`
    ].join("\n");
  }

  if (item.requestType === "permissions") {
    return [
      "Заявка на согласование: изменение прав",
      `Номер: ${item.id.slice(0, 8)}`,
      `Сотрудник: ${item.employeeName}`,
      `Почта: ${item.employeeEmail}`,
      `Отдел: ${item.department}`,
      `Новый доступ: ${item.requestedAccessLevel || "не менять"}`,
      `Добавить: ${item.systemsToAdd.join(", ") || "—"}`,
      `Убрать: ${item.systemsToRemove.join(", ") || "—"}`
    ].join("\n");
  }

  return [
    "Заявка на согласование: подключение",
    `Номер: ${item.id.slice(0, 8)}`,
    `Сотрудник: ${item.fullName}`,
    `Почта: ${item.email}`,
    `Отдел: ${item.department}`,
    `Должность: ${item.position}`,
    `Доступ: ${item.accessLevel}`,
    `Системы: ${item.systems.join(", ") || "—"}`
  ].join("\n");
}

async function notifyManagerForApproval(item) {
  if (!TELEGRAM_BOT_TOKEN || !item.managerTelegramChatId) return;
  await telegramCall("sendMessage", {
    chat_id: item.managerTelegramChatId,
    text: requestApprovalText(item),
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Согласовать", callback_data: `request:${item.id}:approved` },
          { text: "Отклонить", callback_data: `request:${item.id}:rejected` }
        ]
      ]
    }
  });
}

async function notifyAdmin(item) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_ADMIN_CHAT_ID) return;
  const text =
    item.requestType === "offboarding"
      ? [
          "Новая заявка на увольнение",
          `Сотрудник: ${item.employeeName}`,
          `Почта: ${item.employeeEmail}`,
          `Отдел: ${item.department}`,
          `Дата увольнения: ${item.terminationDate}`,
          `Текущие системы: ${item.currentSystems?.join(", ") || item.offboardingActions?.join(", ") || "—"}`,
          `Источник: ${item.source}`
        ].join("\n")
      : item.requestType === "permissions"
        ? [
            "Новая заявка на изменение прав",
            `Сотрудник: ${item.employeeName}`,
            `Почта: ${item.employeeEmail}`,
            `Текущий доступ: ${item.currentAccessLevel || "—"}`,
            `Новый доступ: ${item.requestedAccessLevel || "не менять"}`,
            `Добавить: ${item.systemsToAdd.join(", ") || "—"}`,
            `Убрать: ${item.systemsToRemove.join(", ") || "—"}`,
            `Источник: ${item.source}`
          ].join("\n")
      : [
          "Новая заявка на подключение",
          `ФИО: ${item.fullName}`,
          `Почта: ${item.email}`,
          `Отдел: ${item.department}`,
          `Должность: ${item.position}`,
          `Системы: ${item.systems.join(", ")}`,
          `Источник: ${item.source}`
        ].join("\n");

  await telegramCall("sendMessage", {
    chat_id: TELEGRAM_ADMIN_CHAT_ID,
    text
  });
}

async function telegramCall(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Telegram ${method}: ${response.status}`);
  return response.json();
}

async function handleApprovalCallback(callbackQuery) {
  const data = String(callbackQuery.data || "");
  const [, requestId, status] = data.split(":");
  if (!requestId || !["approved", "rejected"].includes(status)) return;

  const requests = await storage.listRequests();
  const request = requests.find((item) => item.id === requestId);
  if (!request) {
    await telegramCall("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "Заявка не найдена"
    });
    return;
  }

  const approverChatId = String(callbackQuery.message?.chat?.id || "");
  if (request.managerTelegramChatId && approverChatId !== String(request.managerTelegramChatId)) {
    await telegramCall("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "Эта заявка назначена другому руководителю"
    });
    return;
  }

  if (["approved", "rejected", "done"].includes(request.status)) {
    await telegramCall("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "По этой заявке решение уже принято"
    });
    return;
  }

  const now = new Date().toISOString();
  const statusLabel = status === "approved" ? "согласована" : "отклонена";
  const updated = await storage.updateRequestStatus(
    request.id,
    status,
    `${statusLabel} руководителем ${request.manager || ""}`.trim(),
    now
  );

  await telegramCall("answerCallbackQuery", {
    callback_query_id: callbackQuery.id,
    text: status === "approved" ? "Заявка согласована" : "Заявка отклонена"
  });

  if (callbackQuery.message) {
    await telegramCall("editMessageReplyMarkup", {
      chat_id: callbackQuery.message.chat.id,
      message_id: callbackQuery.message.message_id,
      reply_markup: { inline_keyboard: [] }
    });
  }

  if (TELEGRAM_ADMIN_CHAT_ID) {
    await telegramCall("sendMessage", {
      chat_id: TELEGRAM_ADMIN_CHAT_ID,
      text: [
        `Руководитель ${request.manager || "—"}: ${statusLabel}`,
        `Заявка: ${request.id.slice(0, 8)}`,
        `Тип: ${requestTypes[request.requestType] || request.requestType}`,
        `Сотрудник: ${request.fullName || request.employeeName || "—"}`
      ].join("\n")
    });
  }

  return updated;
}

function parseTelegramRequest(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const payload = {};

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    const map = {
      "тип": "requestType",
      "фио": "fullName",
      "сотрудник": "employeeName",
      "почта": "email",
      "email": "email",
      "почта сотрудника": "employeeEmail",
      "телефон": "phone",
      "отдел": "department",
      "должность": "position",
      "руководитель": "manager",
      "дата": "startDate",
      "старт": "startDate",
      "дата увольнения": "terminationDate",
      "отключить": "disableTime",
      "передать": "handoverTo",
      "доступ": "accessLevel",
      "системы": "systems",
      "действия": "offboardingActions",
      "комментарий": "comment"
    };
    if (map[key]) payload[map[key]] = value;
  }

  if (payload.requestType) {
    const value = String(payload.requestType).toLowerCase();
    payload.requestType =
      value.includes("прав") || value.includes("доступ")
        ? "permissions"
        : value.includes("увол") || value.includes("отключ")
          ? "offboarding"
          : "onboarding";
  }

  return payload;
}

async function startTelegramPolling() {
  if (!TELEGRAM_BOT_TOKEN) return;
  console.log("Telegram bot polling is enabled");

  while (true) {
    try {
      const result = await telegramCall("getUpdates", {
        offset: telegramOffset + 1,
        timeout: 25,
        allowed_updates: ["message", "callback_query"]
      });

      for (const update of result.result || []) {
        telegramOffset = update.update_id;
        if (update.callback_query?.data?.startsWith("request:")) {
          await handleApprovalCallback(update.callback_query);
          continue;
        }

        const message = update.message;
        if (!message?.text) continue;

        const chatId = message.chat.id;
        if (message.text === "/start" || message.text === "/help") {
          await telegramCall("sendMessage", {
            chat_id: chatId,
            text:
              `Ваш Telegram chat ID: ${chatId}\n\nОтправьте заявку текстом.\n\nПодключение:\nТип: подключение\nФИО: Иван Иванов\nПочта: ivan@example.com\nТелефон: +380...\nОтдел: Продажи\nДолжность: Менеджер\nДата: 2026-06-10\nДоступ: Базовый\nСистемы: CRM, Почта\n\nУвольнение:\nТип: увольнение\nСотрудник: Иван Иванов\nПочта сотрудника: ivan@example.com\nДата увольнения: 2026-06-20\nОтключить: В день увольнения в 18:00\nПередать: Петр Петров\nДействия: Почта, CRM, VPN`
          });
          continue;
        }

        const parsed = parseTelegramRequest(message.text);
        const { item, errors } = await createRequest(parsed, "telegram");
        await telegramCall("sendMessage", {
          chat_id: chatId,
          text: item
            ? `Заявка создана. Номер: ${item.id.slice(0, 8)}`
            : `Не удалось создать заявку:\n${errors.join("\n")}`
        });
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_DIR, requestedPath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function handleApi(req, res, pathname) {
  if (req.method === "POST" && pathname === "/api/requests") {
    const payload = await readBody(req);
    const { item, errors } = await createRequest(payload, "web");
    sendJson(res, item ? 201 : 422, item ? { item } : { errors });
    return;
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const payload = await readBody(req);
    if (payload.username !== ADMIN_USER || payload.password !== ADMIN_PASSWORD) {
      sendJson(res, 401, { error: "Неверный логин или пароль" });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { username: ADMIN_USER, createdAt: Date.now() });
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `session=${encodeURIComponent(token)}; ${cookieFlags(req)}; Max-Age=28800`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req).session;
    if (token) sessions.delete(token);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": `session=; ${cookieFlags(req)}; Max-Age=0`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    sendJson(res, 200, { authenticated: Boolean(getSession(req)) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/users") {
    const users = await storage.listUsers();
    sendJson(res, 200, { users });
    return;
  }

  if (req.method === "GET" && pathname === "/api/dictionaries") {
    const dictionaries = await listDictionariesWithManagers();
    sendJson(res, 200, { dictionaries });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/dictionaries") {
    if (!requireAdmin(req, res)) return;
    const dictionaries = await listDictionariesWithManagers({ includeArchived: true });
    sendJson(res, 200, { dictionaries, types: dictionaryTypes });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/dictionaries") {
    if (!requireAdmin(req, res)) return;
    const payload = await readBody(req);
    if (!editableDictionaryTypes[payload.type]) {
      sendJson(res, 422, { error: "Руководители редактируются в разделе «Сотрудники»: отметьте сотрудника как руководителя отдела." });
      return;
    }
    const items = await storage.listDictionaryItems({ includeArchived: true });
    const item = normalizeDictionaryItem(payload);
    const errors = validateDictionaryItem(item, items);
    if (errors.length) {
      sendJson(res, 422, { errors });
      return;
    }

    await storage.createDictionaryItem(item);
    sendJson(res, 201, { item });
    return;
  }

  const dictionaryMatch = pathname.match(/^\/api\/admin\/dictionaries\/([^/]+)$/);
  if (dictionaryMatch && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return;
    if (dictionaryMatch[1].startsWith("employee-manager-")) {
      sendJson(res, 422, { error: "Руководители редактируются в разделе «Сотрудники»: откройте карточку сотрудника и измените признак руководителя." });
      return;
    }
    const payload = await readBody(req);
    const items = await storage.listDictionaryItems({ includeArchived: true });
    const existing = items.find((item) => item.id === dictionaryMatch[1]);
    if (!existing) {
      sendJson(res, 404, { error: "Элемент справочника не найден" });
      return;
    }

    const item = normalizeDictionaryItem(payload, existing);
    const errors = validateDictionaryItem(item, items, item.id);
    if (errors.length) {
      sendJson(res, 422, { errors });
      return;
    }

    await storage.updateDictionaryItem(item.id, item);
    sendJson(res, 200, { item });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    if (!requireAdmin(req, res)) return;
    const users = await storage.listUsers({ includeDismissed: true });
    sendJson(res, 200, { users });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/users") {
    if (!requireAdmin(req, res)) return;
    const payload = await readBody(req);
    const users = await storage.listUsers({ includeDismissed: true });
    const user = normalizeUser(payload);
    const errors = validateUser(user, users);
    if (errors.length) {
      sendJson(res, 422, { errors });
      return;
    }

    await storage.createUser(user);
    sendJson(res, 201, { user });
    return;
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (userMatch && req.method === "PATCH") {
    if (!requireAdmin(req, res)) return;
    const payload = await readBody(req);
    const users = await storage.listUsers({ includeDismissed: true });
    const existing = users.find((user) => user.id === userMatch[1]);
    if (!existing) {
      sendJson(res, 404, { error: "Сотрудник не найден" });
      return;
    }

    const user = normalizeUser(payload, existing);
    const errors = validateUser(user, users, user.id, existing);
    if (errors.length) {
      sendJson(res, 422, { errors });
      return;
    }

    await storage.updateUser(user.id, user);
    sendJson(res, 200, { user });
    return;
  }

  if (req.method === "GET" && pathname === "/api/requests") {
    if (!requireAdmin(req, res)) return;
    const requests = await storage.listRequests();
    sendJson(res, 200, { requests });
    return;
  }

  const statusMatch = pathname.match(/^\/api\/requests\/([^/]+)\/status$/);
  if (req.method === "PATCH" && statusMatch) {
    if (!requireAdmin(req, res)) return;
    const payload = await readBody(req);
    const allowed = ["new", "in_progress", "approved", "rejected", "done"];
    if (!allowed.includes(payload.status)) {
      sendJson(res, 422, { error: "Некорректный статус" });
      return;
    }

    const requests = await storage.listRequests();
    const existing = requests.find((request) => request.id === statusMatch[1]);
    if (!existing) {
      sendJson(res, 404, { error: "Заявка не найдена" });
      return;
    }

    const transitionError = validateStatusTransition(existing.status, payload.status, { force: payload.force === true });
    if (transitionError) {
      sendJson(res, 422, { error: transitionError });
      return;
    }

    const now = new Date().toISOString();
    const item = await storage.updateRequestStatus(
      statusMatch[1],
      payload.status,
      String(payload.note || "").trim(),
      now
    );
    if (!item) {
      sendJson(res, 404, { error: "Заявка не найдена" });
      return;
    }

    const effects = await applyCompletedRequestEffects(item);
    sendJson(res, 200, { item, effects });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) console.error(error);
    sendJson(res, statusCode, { error: error.statusCode ? error.message : "Внутренняя ошибка сервера" });
  }
});

if (IS_PRODUCTION && UNSAFE_ADMIN_PASSWORDS.has(ADMIN_PASSWORD)) {
  console.error("");
  console.error("Для production-запуска задайте надежный ADMIN_PASSWORD.");
  console.error("Пример: ADMIN_PASSWORD='long-random-password' docker compose up -d");
  console.error("");
  process.exit(1);
}

storage.init()
  .then(() => {
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error("");
        console.error(`Порт ${PORT} уже занят. Скорее всего, старая версия сервера еще запущена.`);
        console.error("Остановите старый сервер через Ctrl+C в его терминале или запустите новый на другом порту:");
        console.error("   PORT=3003 ./bin/start");
        console.error("");
        process.exit(1);
      }
      console.error(error);
      process.exit(1);
    });

    server.listen(PORT, HOST, () => {
      console.log(`Portal is running: http://${HOST}:${PORT}`);
      console.log(`Admin login: ${ADMIN_USER}`);
    });
    startTelegramPolling();
  })
  .catch((error) => {
    if (error.code === "ECONNREFUSED" || error.errors) {
      console.error("");
      console.error("PostgreSQL сейчас недоступен на localhost:5432.");
      console.error("Запустите базу и повторите: ./bin/start");
      console.error("");
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  });
