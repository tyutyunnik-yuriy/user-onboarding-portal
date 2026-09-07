const statusLabels = {
  new: "Новая",
  in_progress: "В работе",
  approved: "Согласована",
  rejected: "Отклонена",
  done: "Выполнена"
};

const typeLabels = {
  onboarding: "Подключение",
  offboarding: "Увольнение",
  permissions: "Изменение прав"
};

const departmentManagerPosition = "Руководитель отдела";

const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const adminArea = document.querySelector("#adminArea");
const logoutButton = document.querySelector("#logoutButton");
const requestList = document.querySelector("#requestList");
const searchInput = document.querySelector("#searchInput");
const typeFilter = document.querySelector("#typeFilter");
const statusFilter = document.querySelector("#statusFilter");
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const tabPanels = [...document.querySelectorAll("[data-tab-panel]")];
const employeeForm = document.querySelector("#employeeForm");
const employeeSubmitButton = document.querySelector("#employeeSubmitButton");
const employeeCancelButton = document.querySelector("#employeeCancelButton");
const employeeMessage = document.querySelector("#employeeMessage");
const employeeList = document.querySelector("#employeeList");
const employeeSearchInput = document.querySelector("#employeeSearchInput");
const employeeStatusFilter = document.querySelector("#employeeStatusFilter");
const employeeFormHome = document.querySelector("#employeeFormHome");
const employeeDictionarySelects = [...document.querySelectorAll("[data-employee-dictionary]")];
const employeeSystemsGroup = document.querySelector("[data-employee-systems]");
const employeeManagerLabel = document.querySelector("#employeeManagerLabel");
const employeeSubdivisionLabel = document.querySelector("#employeeSubdivisionLabel");
const dictionaryForm = document.querySelector("#dictionaryForm");
const dictionarySubmitButton = document.querySelector("#dictionarySubmitButton");
const dictionaryCancelButton = document.querySelector("#dictionaryCancelButton");
const dictionaryMessage = document.querySelector("#dictionaryMessage");
const dictionaryList = document.querySelector("#dictionaryList");
const dictionaryFormHome = document.querySelector("#dictionaryFormHome");
const dictionaryValueLabel = document.querySelector("#dictionaryValueLabel");
const positionExtraFields = [...document.querySelectorAll(".position-extra")];
const systemExtraFields = [...document.querySelectorAll(".system-extra")];
const departmentExtraFields = [...document.querySelectorAll(".department-extra")];
const systemSubdivisionsGroup = document.querySelector("[data-system-subdivisions]");
const departmentBusinessUnitsGroup = document.querySelector("[data-department-business-units]");
const managerBusinessUnitsGroup = document.querySelector("[data-manager-business-units]");
const managerBusinessUnitsFields = [...document.querySelectorAll(".manager-business-units")];

let requests = [];
let employees = [];
let dictionaries = { departments: [], positions: [], subdivisions: [], managers: [], accessLevels: [], systems: [] };
let requestPage = 1;
let expandedRequestId = "";
const requestsPerPage = 10;
let employeePage = 1;
let expandedEmployeeId = "";
const employeesPerPage = 10;
let dictionaryTypes = {
  departments: "Отделы",
  positions: "Должности",
  subdivisions: "Бизнес-юниты",
  managers: "Руководители",
  accessLevels: "Уровни доступа",
  systems: "Системы"
};

function formatPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("380")) digits = digits.slice(3);
  if (digits.startsWith("38")) digits = digits.slice(2);
  if (digits.startsWith("8") && digits.length > 10) digits = digits.slice(1);
  if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 9);

  const operator = digits.slice(0, 2);
  const first = digits.slice(2, 5);
  const second = digits.slice(5, 7);
  const third = digits.slice(7, 9);
  let result = "+38";
  if (operator) result += ` (0${operator}`;
  if (operator.length === 2) result += ")";
  if (first) result += ` ${first}`;
  if (second) result += `-${second}`;
  if (third) result += `-${third}`;
  return result;
}

function setupPhoneMasks(scope = document) {
  scope.querySelectorAll("[data-phone-mask]").forEach((input) => {
    input.addEventListener("input", () => {
      input.value = formatPhone(input.value);
    });
    input.addEventListener("blur", () => {
      input.value = formatPhone(input.value);
    });
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .replace(/ё/g, "е")
    .toLowerCase();
}

function matchesSearch(text, query) {
  const tokens = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearch(text);
  const digits = haystack.replace(/\D/g, "");
  return tokens.every((token) => {
    const tokenDigits = token.replace(/\D/g, "");
    return haystack.includes(token) || (tokenDigits && digits.includes(tokenDigits));
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const result = await response.json();
  if (!response.ok) {
    const message = result.error || result.errors?.join(". ") || "Ошибка";
    if (message === "API route not found") {
      throw new Error("Сервер запущен старой версией. Перезапустите сервер и обновите страницу.");
    }
    throw new Error(message);
  }
  return result;
}

async function checkAuth() {
  const result = await api("/api/me");
  if (result.authenticated) showAdmin();
}

async function showAdmin() {
  loginForm.classList.add("hidden");
  adminArea.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  await loadDictionaries();
  await loadRequests();
  await loadEmployees();
}

async function loadRequests() {
  const result = await api("/api/requests");
  requests = result.requests;
  renderRequests();
}

function renderRequests() {
  const query = searchInput.value;
  const type = typeFilter.value;
  const status = statusFilter.value;
  const filtered = requests.filter((item) => {
    const text = [
      item.fullName,
      item.employeeName,
      item.department,
      item.position,
      item.email,
      item.employeeEmail,
      item.systems?.join(", "),
      item.currentSystems?.join(", "),
      item.offboardingActions?.join(", ")
    ].join(" ");
    return matchesSearch(text, query) && (!type || item.requestType === type) && (!status || item.status === status);
  });

  if (filtered.length === 0) {
    requestList.innerHTML = '<div class="panel">Заявок пока нет</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / requestsPerPage));
  requestPage = Math.min(Math.max(requestPage, 1), totalPages);
  const start = (requestPage - 1) * requestsPerPage;
  const pageItems = filtered.slice(start, start + requestsPerPage);

  requestList.innerHTML = `
    <div class="request-compact-list">
      ${pageItems.map(renderCard).join("")}
    </div>
    ${renderRequestPagination(filtered.length, totalPages)}
  `;
}

async function loadEmployees() {
  const result = await api("/api/admin/users");
  employees = result.users;
  renderEmployees();
}

async function loadDictionaries() {
  const result = await api("/api/admin/dictionaries");
  dictionaries = result.dictionaries;
  dictionaryTypes = result.types || dictionaryTypes;
  renderDictionaries();
  fillEmployeeDictionarySelects();
  fillSubdivisionSelect();
  fillDictionaryDepartmentSelect();
  fillSystemSubdivisionCheckboxes();
  fillBusinessUnitCheckboxes(departmentBusinessUnitsGroup);
  fillManagerBusinessUnitCheckboxes();
}

function fillEmployeeDictionarySelects() {
  employeeDictionarySelects.forEach((select) => {
    if (select.dataset.employeeDictionary === "positions" || select.dataset.employeeDictionary === "departments") return;
    const first = select.querySelector("option")?.outerHTML || '<option value="">Выберите</option>';
    const current = select.value;
    const values = dictionaries[select.dataset.employeeDictionary] || [];
    select.innerHTML = first + values.filter((item) => item.status !== "archived").map(optionHtml).join("");
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    }
  });
  fillEmployeeDepartmentSelect();
  fillEmployeePositionSelect();
  fillEmployeeSystemCheckboxes();
}

function positionsForDepartment(department) {
  const normalizedDepartment = String(department || "").trim().toLowerCase();
  return (dictionaries.positions || []).filter((item) => {
    if (item.status === "archived") return false;
    const positionDepartment = String(item.metadata?.department || "").trim().toLowerCase();
    return !positionDepartment || !normalizedDepartment || positionDepartment === normalizedDepartment;
  });
}

function departmentsForSubdivision(subdivision) {
  const normalizedSubdivision = String(subdivision || "").trim().toLowerCase();
  return (dictionaries.departments || []).filter((item) => {
    if (item.status === "archived") return false;
    const departmentSubdivisions = metadataSubdivisions(item.metadata).map((entry) => entry.toLowerCase());
    return departmentSubdivisions.length === 0 || !normalizedSubdivision || departmentSubdivisions.includes(normalizedSubdivision);
  });
}

function systemsForSubdivision(subdivision) {
  const normalizedSubdivision = String(subdivision || "").trim().toLowerCase();
  return (dictionaries.systems || []).filter((item) => {
    if (item.status === "archived") return false;
    const systemSubdivisions = metadataSubdivisions(item.metadata).map((entry) => entry.toLowerCase());
    return systemSubdivisions.length === 0 || !normalizedSubdivision || systemSubdivisions.includes(normalizedSubdivision);
  });
}

function metadataSubdivisions(metadata = {}) {
  const raw = Array.isArray(metadata.subdivisions)
    ? metadata.subdivisions
    : String(metadata.subdivisions || metadata.subdivision || "")
        .split(",")
        .map((item) => item.trim());
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function fillEmployeePositionSelect(selected = employeeForm.elements.position.value) {
  const select = employeeForm.elements.position;
  const first = select.querySelector("option")?.outerHTML || '<option value="">Выберите должность</option>';
  const values = positionsForDepartment(employeeForm.elements.department.value);
  const selectedExists = values.some((item) => item.value === selected);
  const fallbackOption =
    selected && !selectedExists ? `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>` : "";
  select.innerHTML = first + values.map(optionHtml).join("") + fallbackOption;
  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function fillEmployeeDepartmentSelect(selected = employeeForm.elements.department.value) {
  const select = employeeForm.elements.department;
  const first = '<option value="">Выберите отдел</option>';
  const values = departmentsForSubdivision(employeeForm.elements.subdivision.value);
  select.innerHTML = first + values.map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function optionHtml(item) {
  return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.value)}</option>`;
}

function fillEmployeeSystemCheckboxes(selected = []) {
  const selectedSet = new Set(selected);
  const systems = systemsForSubdivision(employeeForm.elements.subdivision.value || employeeForm.elements.department.value);
  const existing = new Set(systems.map((item) => item.value));
  const selectedOutsideSubdivision = selected
    .filter((value) => !existing.has(value))
    .map((value) => ({ value, metadata: { subdivision: "уже назначено" }, status: "active" }));
  const visibleSystems = [...systems, ...selectedOutsideSubdivision];
  employeeSystemsGroup.innerHTML = visibleSystems.length
    ? visibleSystems
        .map(
          (item) => `
            <label>
              <input type="checkbox" name="systems" value="${escapeHtml(item.value)}" ${
                selectedSet.has(item.value) ? "checked" : ""
              } />
              ${escapeHtml(item.value)}
              ${
                selectedOutsideSubdivision.some((system) => system.value === item.value)
                  ? '<span class="meta"> уже назначено вне набора бизнес-юнита</span>'
                  : ""
              }
            </label>
          `
        )
        .join("")
    : '<p class="meta">В справочнике систем пока нет активных значений</p>';
}

function fillSubdivisionSelect() {
  const select = dictionaryForm.elements.subdivision;
  if (!select) return;
  const first = '<option value="">Выберите бизнес-юнит</option>';
  const current = select.value;
  const values = dictionaries.subdivisions || [];
  select.innerHTML = first + values.filter((item) => item.status !== "archived").map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function fillSystemSubdivisionCheckboxes(selected = []) {
  const selectedSet = new Set(selected);
  const subdivisions = (dictionaries.subdivisions || []).filter((item) => item.status !== "archived");
  systemSubdivisionsGroup.innerHTML = subdivisions.length
    ? subdivisions
        .map(
          (item) => `
            <label>
              <input type="checkbox" name="subdivisions" value="${escapeHtml(item.value)}" ${
                selectedSet.has(item.value) ? "checked" : ""
              } />
              ${escapeHtml(item.value)}
            </label>
          `
        )
        .join("")
    : '<p class="meta">Сначала добавьте бизнес-юниты</p>';
}

function fillBusinessUnitCheckboxes(group, selected = []) {
  const selectedSet = new Set(selected);
  const subdivisions = (dictionaries.subdivisions || []).filter((item) => item.status !== "archived");
  group.innerHTML = subdivisions.length
    ? subdivisions
        .map(
          (item) => `
            <label>
              <input type="checkbox" name="subdivisions" value="${escapeHtml(item.value)}" ${
                selectedSet.has(item.value) ? "checked" : ""
              } />
              ${escapeHtml(item.value)}
            </label>
          `
        )
        .join("")
    : '<p class="meta">Сначала добавьте бизнес-юниты</p>';
}

function fillManagerBusinessUnitCheckboxes(selected = []) {
  const ownBusinessUnit = employeeForm.elements.subdivision.value;
  const selectedSet = new Set(selected.filter((value) => value !== ownBusinessUnit));
  const subdivisions = (dictionaries.subdivisions || []).filter(
    (item) => item.status !== "archived" && item.value !== ownBusinessUnit
  );
  managerBusinessUnitsGroup.innerHTML = subdivisions.length
    ? subdivisions
        .map(
          (item) => `
            <label>
              <input type="checkbox" name="subdivisions" value="${escapeHtml(item.value)}" ${
                selectedSet.has(item.value) ? "checked" : ""
              } />
              ${escapeHtml(item.value)}
            </label>
          `
        )
        .join("")
    : '<p class="meta">Основной бизнес-юнит уже входит в зону ответственности</p>';
}

function fillDictionaryDepartmentSelect() {
  const select = dictionaryForm.elements.department;
  const first = '<option value="">Выберите отдел</option>';
  const current = select.value;
  const values = dictionaries.departments || [];
  select.innerHTML = first + values.filter((item) => item.status !== "archived").map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function renderEmployees() {
  moveEmployeeFormHome();
  const query = employeeSearchInput.value;
  const status = employeeStatusFilter.value;
  const filtered = employees.filter((employee) => {
    const text = [
      employee.fullName,
      employee.lastName,
      employee.firstName,
      employee.middleName,
      employee.email,
      employee.phone,
      employee.telegramChatId,
      employee.department,
      employee.subdivision,
      employee.position,
      employee.manager,
      employee.isDepartmentManager ? "руководитель отдела" : "",
      employee.accessLevel,
      employee.systems?.join(", ")
    ].join(" ");
    return matchesSearch(text, query) && (!status || employee.status === status);
  });

  if (filtered.length === 0) {
    employeeList.innerHTML = '<div class="panel">Сотрудников пока нет</div>';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / employeesPerPage));
  employeePage = Math.min(Math.max(employeePage, 1), totalPages);
  const start = (employeePage - 1) * employeesPerPage;
  const pageItems = filtered.slice(start, start + employeesPerPage);

  employeeList.innerHTML = `
    <div class="employee-compact-list">
      ${pageItems.map(renderEmployeeCard).join("")}
    </div>
    ${renderEmployeePagination(filtered.length, totalPages)}
  `;
}

function moveEmployeeFormHome() {
  if (employeeForm.parentElement !== employeeFormHome) {
    employeeFormHome.append(employeeForm);
  }
  employeeForm.classList.remove("inline-edit");
  document.querySelectorAll(".employee-card.editing").forEach((card) => card.classList.remove("editing"));
}

function moveEmployeeFormToCard(card) {
  if (!card) return;
  card.classList.add("editing");
  card.after(employeeForm);
  employeeForm.classList.add("inline-edit");
  employeeForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function renderEmployeeCard(employee) {
  const statusLabel = employee.status === "dismissed" ? "Отключен" : "Активен";
  const expanded = expandedEmployeeId === employee.id;
  return `
    <article class="request-card employee-card compact ${expanded ? "expanded" : ""}">
      <button class="employee-summary" type="button" data-toggle-employee-details="${employee.id}" aria-expanded="${expanded}">
        <div>
          <strong>${escapeHtml(employee.fullName)}</strong>
          <span class="meta">${escapeHtml(employee.position)} · ${escapeHtml(employee.department)} · ${escapeHtml(employee.subdivision || "—")}</span>
        </div>
        <span class="employee-summary-meta">${escapeHtml(employee.email)}</span>
        <span class="status ${employee.status === "dismissed" ? "rejected" : "approved"}">${statusLabel}</span>
      </button>
      ${
        expanded
          ? `
            <div class="employee-expanded">
              <div class="details">
                ${detail("Телефон", employee.phone || "—")}
                ${detail("Telegram", employee.telegramChatId || "—")}
                ${detail("Бизнес-юнит", employee.subdivision || "—")}
                ${detail("Руководитель", employee.manager)}
                ${detail("Роль", employee.isDepartmentManager ? "Руководитель отдела" : "Сотрудник")}
                ${employee.isDepartmentManager ? detail("Отвечает за бизнес-юниты", employee.managedSubdivisions?.join(", ") || "—") : ""}
                ${detail("Уровень доступа", employee.accessLevel || "—")}
                ${detail("Системы", employee.systems?.join(", ") || "—")}
                ${detail("ID", employee.id)}
              </div>
              <div class="status-controls">
                <button type="button" data-edit-employee="${employee.id}">Редактировать</button>
                <button class="secondary" type="button" data-toggle-employee="${employee.id}">
                  ${employee.status === "dismissed" ? "Восстановить сотрудника" : "Отключить учетку"}
                </button>
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderEmployeePagination(total, totalPages) {
  const first = (employeePage - 1) * employeesPerPage + 1;
  const last = Math.min(employeePage * employeesPerPage, total);
  return `
    <div class="pagination">
      <span class="meta">Показаны ${first}-${last} из ${total}</span>
      <div>
        <button class="secondary" type="button" data-employee-page="${employeePage - 1}" ${employeePage <= 1 ? "disabled" : ""}>
          Назад
        </button>
        <span>${employeePage} / ${totalPages}</span>
        <button class="secondary" type="button" data-employee-page="${employeePage + 1}" ${employeePage >= totalPages ? "disabled" : ""}>
          Вперед
        </button>
      </div>
    </div>
  `;
}

function renderDictionaries() {
  moveDictionaryFormHome();
  const selectedType = dictionaryForm.elements.type.value;
  const selectedLabel = dictionaryTypes[selectedType] || "Справочник";
  const isManagerDirectory = selectedType === "managers";
  const items = dictionaries[selectedType] || [];
  const activeCount = items.filter((item) => item.status !== "archived").length;
  const archivedCount = items.length - activeCount;
  const rows =
    items.length === 0
      ? '<p class="meta">В этом справочнике пока пусто</p>'
      : items.map((item) => renderDictionaryItem(item)).join("");

  dictionaryList.innerHTML = `
    <div class="dictionary-summary">
      ${Object.entries(dictionaryTypes)
        .map(([type, label]) => {
          const total = dictionaries[type]?.length || 0;
          return `
            <button class="dictionary-filter ${type === selectedType ? "active" : ""}" type="button" data-dictionary-type="${type}">
              <strong>${escapeHtml(label)}</strong>
              <span>${total}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    <section class="panel dictionary-column">
      <div class="dictionary-heading">
        <div>
          <h2>${escapeHtml(selectedLabel)}</h2>
          <p class="meta">${
            isManagerDirectory
              ? "Руководители формируются из сотрудников с признаком руководителя отдела."
              : `Активных: ${activeCount} · скрытых: ${archivedCount}. Для редактирования нажмите на строку.`
          }</p>
        </div>
      </div>
      <div class="dictionary-items compact">${rows}</div>
    </section>
  `;
}

function renderDictionaryItem(item) {
  if (item.type === "managers") {
    return `
      <div class="dictionary-item compact-row readonly">
        <div>
          <strong>${escapeHtml(item.value)}</strong>
          <span class="meta">${escapeHtml(item.metadata?.phone || "телефон не указан")} · ${escapeHtml(
            metadataSubdivisions(item.metadata).join(", ") || item.metadata?.subdivision || "бизнес-юнит не указан"
          )} · Telegram: ${escapeHtml(item.metadata?.telegramChatId || "не указан")}</span>
        </div>
        <span class="status approved">Из сотрудника</span>
      </div>
    `;
  }

  const statusLabel = item.status === "archived" ? "Скрыт" : "Активен";
  const positionMeta =
    item.type === "positions" ? `<span class="meta">Отдел: ${escapeHtml(item.metadata?.department || "не указан")}</span>` : "";
  const departmentMeta =
    item.type === "departments"
      ? `<span class="meta">Бизнес-юниты: ${escapeHtml(metadataSubdivisions(item.metadata).join(", ") || "для всех")}</span>`
      : "";
  const systemMeta =
    item.type === "systems"
      ? `<span class="meta">Бизнес-юниты: ${escapeHtml(metadataSubdivisions(item.metadata).join(", ") || "для всех")}</span>`
      : "";
  const actionLabel = item.status === "archived" ? "Восстановить" : "Скрыть";
  return `
    <article class="dictionary-item compact-row ${item.status === "archived" ? "archived" : ""}" data-dictionary-row="${item.id}">
      <div>
        <strong>${escapeHtml(item.value)}</strong>
        ${departmentMeta}
        ${positionMeta}
        ${systemMeta}
      </div>
      <span class="status ${item.status === "archived" ? "rejected" : "approved"}">${statusLabel}</span>
      <div class="dictionary-actions">
        <button class="secondary" type="button" data-edit-dictionary="${item.id}">Редактировать</button>
        <button class="secondary" type="button" data-toggle-dictionary="${item.id}">${actionLabel}</button>
      </div>
    </article>
  `;
}

function renderCard(item) {
  const createdAt = new Date(item.createdAt).toLocaleString("ru-RU");
  const requestType = item.requestType || "onboarding";
  const title = requestType === "onboarding" ? item.fullName : item.employeeName;
  const subtitle =
    requestType === "onboarding"
      ? `${item.email} · ${item.department} · ${createdAt}`
      : `${item.employeeEmail} · ${item.department} · ${createdAt}`;
  const expanded = expandedRequestId === item.id;

  return `
    <article class="request-card request-compact ${expanded ? "expanded" : ""}">
      <button class="request-summary" type="button" data-toggle-request-details="${item.id}" aria-expanded="${expanded}">
        <div>
          <p class="request-type">${typeLabels[requestType]}</p>
          <strong>${escapeHtml(title || "Без имени")}</strong>
          <span class="meta">${escapeHtml(subtitle)}</span>
        </div>
        <span class="request-summary-meta">${escapeHtml(item.id.slice(0, 8))}</span>
        <span class="status ${item.status}">${statusLabels[item.status]}</span>
      </button>
      ${
        expanded
          ? `
            <div class="request-expanded">
              <div class="details">
                ${renderDetails(item)}
                ${detail("Источник", item.source)}
                ${detail("Комментарий", item.comment || "—")}
              </div>
              <div class="status-controls">
                <select data-status-for="${item.id}">
                  ${Object.entries(statusLabels)
                    .map(([value, label]) => `<option value="${value}" ${value === item.status ? "selected" : ""}>${label}</option>`)
                    .join("")}
                </select>
                <button type="button" data-save-status="${item.id}">Сохранить статус</button>
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderRequestPagination(total, totalPages) {
  const first = (requestPage - 1) * requestsPerPage + 1;
  const last = Math.min(requestPage * requestsPerPage, total);
  return `
    <div class="pagination">
      <span class="meta">Показаны ${first}-${last} из ${total}</span>
      <div>
        <button class="secondary" type="button" data-request-page="${requestPage - 1}" ${requestPage <= 1 ? "disabled" : ""}>
          Назад
        </button>
        <span>${requestPage} / ${totalPages}</span>
        <button class="secondary" type="button" data-request-page="${requestPage + 1}" ${requestPage >= totalPages ? "disabled" : ""}>
          Вперед
        </button>
      </div>
    </div>
  `;
}

function renderDetails(item) {
  const requestType = item.requestType || "onboarding";
  if (requestType === "offboarding") {
    return [
      detail("Почта", item.employeeEmail),
      detail("Отдел", item.department),
      detail("Руководитель", item.manager),
      detail("Дата увольнения", item.terminationDate),
      detail("Отключение", item.disableTime),
      detail("Передать данные", item.handoverTo),
      detail("Текущие системы", item.currentSystems?.join(", ") || item.offboardingActions?.join(", ") || "—")
    ].join("");
  }

  if (requestType === "permissions") {
    return [
      detail("Почта", item.employeeEmail),
      detail("Отдел", item.department),
      detail("Руководитель", item.manager),
      detail("Текущий доступ", item.currentAccessLevel || "—"),
      detail("Новый доступ", item.requestedAccessLevel || "Не менять"),
      detail("Сейчас есть", item.currentSystems?.join(", ") || "—"),
      detail("После изменения", item.requestedSystems?.join(", ") || "—"),
      detail("Добавить", item.systemsToAdd?.join(", ") || "—"),
      detail("Убрать", item.systemsToRemove?.join(", ") || "—")
    ].join("");
  }

  return [
    detail("Телефон", item.phone),
    detail("Должность", item.position),
    detail("Руководитель", item.manager),
    detail("Старт", item.startDate),
    detail("Доступ", item.accessLevel),
    detail("Системы", item.systems?.join(", ") || "—")
  ].join("");
}

function detail(label, value) {
  return `<div><strong>${label}</strong>${escapeHtml(String(value))}</div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function setActiveTab(name) {
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  tabPanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.tabPanel !== name));
}

function resetEmployeeForm() {
  moveEmployeeFormHome();
  employeeForm.reset();
  employeeForm.elements.id.value = "";
  fillManagerBusinessUnitCheckboxes();
  syncEmployeeManagerField();
  fillEmployeeSystemCheckboxes();
  employeeSubmitButton.textContent = "Добавить сотрудника";
  employeeCancelButton.classList.add("hidden");
  employeeMessage.textContent = "";
}

function fillEmployeeForm(employee) {
  employeeForm.elements.id.value = employee.id;
  employeeForm.elements.lastName.value = employee.lastName || "";
  employeeForm.elements.firstName.value = employee.firstName || "";
  employeeForm.elements.middleName.value = employee.middleName || "";
  employeeForm.elements.email.value = employee.email;
  employeeForm.elements.phone.value = employee.phone || "";
  employeeForm.elements.telegramChatId.value = employee.telegramChatId || "";
  employeeForm.elements.subdivision.value = employee.subdivision || employee.department || "";
  fillEmployeeDepartmentSelect(employee.department);
  fillEmployeePositionSelect(employee.position);
  employeeForm.elements.manager.value = employee.manager;
  employeeForm.elements.isDepartmentManager.checked = Boolean(employee.isDepartmentManager);
  fillManagerBusinessUnitCheckboxes(employee.managedSubdivisions || []);
  syncEmployeeManagerField();
  employeeForm.elements.accessLevel.value = employee.accessLevel || "";
  employeeForm.elements.status.value = employee.status;
  fillEmployeeSystemCheckboxes(employee.systems || []);
  employeeSubmitButton.textContent = "Сохранить сотрудника";
  employeeCancelButton.classList.remove("hidden");
  employeeMessage.textContent = "";
}

function syncManagerBusinessUnits() {
  const selected = new FormData(employeeForm).getAll("subdivisions");
  fillManagerBusinessUnitCheckboxes(selected);
}

function syncEmployeeManagerField() {
  const isDepartmentManager = employeeForm.elements.isDepartmentManager.checked;
  const positionSelect = employeeForm.elements.position;
  employeeForm.elements.manager.required = !isDepartmentManager;
  employeeForm.elements.subdivision.required = true;
  positionSelect.disabled = isDepartmentManager;
  positionSelect.required = !isDepartmentManager;
  if (isDepartmentManager) {
    fillEmployeePositionSelect(departmentManagerPosition);
    positionSelect.value = departmentManagerPosition;
  } else if (positionSelect.value === departmentManagerPosition) {
    positionSelect.value = "";
  }
  managerBusinessUnitsFields.forEach((field) => field.classList.toggle("hidden", !isDepartmentManager));
  employeeManagerLabel.textContent = isDepartmentManager ? "Руководитель" : "Руководитель *";
  employeeSubdivisionLabel.textContent = isDepartmentManager ? "Бизнес-юнит *" : "Бизнес-юнит";
  syncManagerBusinessUnits();
}

function moveDictionaryFormHome() {
  if (dictionaryForm.parentElement !== dictionaryFormHome) {
    dictionaryFormHome.append(dictionaryForm);
  }
  dictionaryForm.classList.remove("inline-edit");
  document.querySelectorAll(".dictionary-item.editing").forEach((item) => item.classList.remove("editing"));
}

function moveDictionaryFormToItem(item) {
  if (!item) return;
  item.classList.add("editing");
  item.after(dictionaryForm);
  dictionaryForm.classList.add("inline-edit");
  dictionaryForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetDictionaryForm(options = {}) {
  const selectedType = options.type || dictionaryForm.elements.type.value || "departments";
  moveDictionaryFormHome();
  dictionaryForm.reset();
  dictionaryForm.elements.id.value = "";
  dictionaryForm.elements.type.value = selectedType;
  fillBusinessUnitCheckboxes(departmentBusinessUnitsGroup);
  fillSystemSubdivisionCheckboxes();
  syncDictionaryForm();
  dictionarySubmitButton.textContent = "Добавить значение";
  dictionaryCancelButton.classList.add("hidden");
  dictionaryMessage.textContent = "";
}

function allDictionaryItems() {
  return Object.values(dictionaries).flat();
}

function fillDictionaryForm(item) {
  dictionaryForm.elements.id.value = item.id;
  dictionaryForm.elements.type.value = item.type;
  dictionaryForm.elements.value.value = item.value;
  dictionaryForm.elements.department.value = item.metadata?.department || "";
  fillBusinessUnitCheckboxes(departmentBusinessUnitsGroup, metadataSubdivisions(item.metadata));
  fillSystemSubdivisionCheckboxes(metadataSubdivisions(item.metadata));
  dictionaryForm.elements.status.value = item.status;
  syncDictionaryForm({ render: false });
  dictionarySubmitButton.textContent = "Сохранить значение";
  dictionaryCancelButton.classList.remove("hidden");
  dictionaryMessage.textContent = "";
  renderDictionaries();
  moveDictionaryFormToItem(document.querySelector(`[data-dictionary-row="${item.id}"]`));
}

function syncDictionaryForm(options = {}) {
  const shouldRender = options.render !== false;
  const isManager = dictionaryForm.elements.type.value === "managers";
  const isPosition = dictionaryForm.elements.type.value === "positions";
  const isSystem = dictionaryForm.elements.type.value === "systems";
  const isDepartment = dictionaryForm.elements.type.value === "departments";
  dictionaryValueLabel.textContent = isManager ? "Редактируется в сотрудниках" : "Значение *";
  positionExtraFields.forEach((field) => field.classList.toggle("hidden", !isPosition));
  systemExtraFields.forEach((field) => field.classList.toggle("hidden", !isSystem));
  departmentExtraFields.forEach((field) => field.classList.toggle("hidden", !isDepartment));
  dictionaryForm.elements.value.disabled = isManager;
  dictionaryForm.elements.value.required = !isManager;
  dictionaryForm.elements.department.disabled = isManager || !isPosition;
  dictionaryForm.elements.department.required = isPosition && !isManager;
  systemSubdivisionsGroup.querySelectorAll("input").forEach((input) => {
    input.disabled = isManager || !isSystem;
  });
  departmentBusinessUnitsGroup.querySelectorAll("input").forEach((input) => {
    input.disabled = isManager || !isDepartment;
  });
  dictionaryForm.elements.status.disabled = isManager;
  dictionarySubmitButton.disabled = isManager;
  dictionarySubmitButton.textContent = isManager ? "Недоступно здесь" : dictionaryForm.elements.id.value ? "Сохранить значение" : "Добавить значение";
  if (isManager) {
    dictionaryForm.elements.value.value = "";
    dictionaryForm.elements.id.value = "";
    dictionaryCancelButton.classList.add("hidden");
    dictionaryMessage.textContent = "Чтобы добавить руководителя, откройте вкладку «Сотрудники» и поставьте галку «Руководитель отдела».";
  }
  if (shouldRender) renderDictionaries();
}

function employeePayloadFromForm() {
  const formData = new FormData(employeeForm);
  const payload = Object.fromEntries(formData.entries());
  payload.systems = formData.getAll("systems");
  const managedSubdivisions = employeeForm.elements.isDepartmentManager.checked ? formData.getAll("subdivisions") : [];
  if (employeeForm.elements.isDepartmentManager.checked) {
    payload.position = departmentManagerPosition;
  }
  if (employeeForm.elements.isDepartmentManager.checked && payload.subdivision && !managedSubdivisions.includes(payload.subdivision)) {
    managedSubdivisions.push(payload.subdivision);
  }
  payload.managedSubdivisions = managedSubdivisions;
  return payload;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "Проверяем...";
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(payload) });
    loginMessage.textContent = "";
    await showAdmin();
  } catch (error) {
    loginMessage.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST", body: "{}" });
  loginForm.classList.remove("hidden");
  adminArea.classList.add("hidden");
  logoutButton.classList.add("hidden");
});

requestList.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-request-page]");
  if (pageButton) {
    requestPage = Number(pageButton.dataset.requestPage) || 1;
    expandedRequestId = "";
    renderRequests();
    return;
  }

  const summaryButton = event.target.closest("[data-toggle-request-details]");
  if (summaryButton) {
    const id = summaryButton.dataset.toggleRequestDetails;
    expandedRequestId = expandedRequestId === id ? "" : id;
    renderRequests();
    return;
  }

  const button = event.target.closest("[data-save-status]");
  if (!button) return;
  const id = button.dataset.saveStatus;
  const select = document.querySelector(`[data-status-for="${id}"]`);
  try {
    const result = await api(`/api/requests/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    await loadRequests();
    await loadEmployees();
    if (result.effects?.length) {
      employeeMessage.textContent = result.effects.join(". ");
    }
  } catch (error) {
    employeeMessage.textContent = error.message;
    await loadRequests();
  }
});

employeeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  employeeMessage.textContent = "Сохраняем...";
  const payload = employeePayloadFromForm();
  const id = payload.id;
  delete payload.id;

  try {
    await api(id ? `/api/admin/users/${id}` : "/api/admin/users", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    resetEmployeeForm();
    await loadEmployees();
    employeeMessage.textContent = "Сотрудник сохранен";
  } catch (error) {
    employeeMessage.textContent = error.message;
  }
});

employeeCancelButton.addEventListener("click", resetEmployeeForm);
employeeForm.elements.isDepartmentManager.addEventListener("change", syncEmployeeManagerField);
employeeForm.elements.department.addEventListener("change", () => {
  fillEmployeePositionSelect("");
  syncEmployeeManagerField();
  fillEmployeeSystemCheckboxes(new FormData(employeeForm).getAll("systems"));
});
employeeForm.elements.subdivision.addEventListener("change", () => {
  fillEmployeeDepartmentSelect("");
  fillEmployeePositionSelect("");
  syncEmployeeManagerField();
  syncManagerBusinessUnits();
  fillEmployeeSystemCheckboxes(new FormData(employeeForm).getAll("systems"));
});

employeeList.addEventListener("click", async (event) => {
  const pageButton = event.target.closest("[data-employee-page]");
  if (pageButton) {
    employeePage = Number(pageButton.dataset.employeePage) || 1;
    expandedEmployeeId = "";
    renderEmployees();
    return;
  }

  const summaryButton = event.target.closest("[data-toggle-employee-details]");
  if (summaryButton) {
    const id = summaryButton.dataset.toggleEmployeeDetails;
    expandedEmployeeId = expandedEmployeeId === id ? "" : id;
    renderEmployees();
    return;
  }

  const editButton = event.target.closest("[data-edit-employee]");
  if (editButton) {
    const employee = employees.find((item) => item.id === editButton.dataset.editEmployee);
    if (employee) {
      fillEmployeeForm(employee);
      moveEmployeeFormToCard(editButton.closest(".employee-card"));
    }
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-employee]");
  if (!toggleButton) return;
  const employee = employees.find((item) => item.id === toggleButton.dataset.toggleEmployee);
  if (!employee) return;

  const payload = {
    ...employee,
    status: employee.status === "dismissed" ? "active" : "dismissed"
  };
  employeeMessage.textContent = employee.status === "dismissed" ? "Восстанавливаем сотрудника..." : "Отключаем учетку...";
  try {
    await api(`/api/admin/users/${employee.id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await loadEmployees();
    employeeMessage.textContent = employee.status === "dismissed" ? "Сотрудник восстановлен" : "Учетка отключена";
  } catch (error) {
    employeeMessage.textContent = error.message;
  }
});

dictionaryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(dictionaryForm);
  const payload = Object.fromEntries(formData.entries());
  payload.subdivisions = formData.getAll("subdivisions");
  const selectedType = payload.type || dictionaryForm.elements.type.value;
  if (payload.type === "managers") {
    dictionaryMessage.textContent = "Руководители редактируются во вкладке «Сотрудники».";
    return;
  }
  dictionaryMessage.textContent = "Сохраняем...";
  const id = payload.id;
  delete payload.id;

  try {
    await api(id ? `/api/admin/dictionaries/${id}` : "/api/admin/dictionaries", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    resetDictionaryForm({ type: selectedType });
    await loadDictionaries();
    dictionaryForm.elements.type.value = selectedType;
    renderDictionaries();
    dictionaryMessage.textContent = "Справочник сохранен";
  } catch (error) {
    dictionaryMessage.textContent = error.message;
  }
});

dictionaryCancelButton.addEventListener("click", () => resetDictionaryForm());
dictionaryForm.elements.type.addEventListener("change", () => {
  resetDictionaryForm({ type: dictionaryForm.elements.type.value });
});

dictionaryList.addEventListener("click", async (event) => {
  const typeButton = event.target.closest("[data-dictionary-type]");
  if (typeButton) {
    resetDictionaryForm({ type: typeButton.dataset.dictionaryType });
    return;
  }

  const editButton = event.target.closest("[data-edit-dictionary]");
  if (editButton) {
    const item = allDictionaryItems().find((entry) => entry.id === editButton.dataset.editDictionary);
    if (item) fillDictionaryForm(item);
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-dictionary]");
  if (toggleButton) {
    const item = allDictionaryItems().find((entry) => entry.id === toggleButton.dataset.toggleDictionary);
    if (!item) return;
    const selectedType = dictionaryForm.elements.type.value;
    const nextStatus = item.status === "archived" ? "active" : "archived";
    dictionaryMessage.textContent = nextStatus === "active" ? "Восстанавливаем значение..." : "Скрываем значение...";
    try {
      await api(`/api/admin/dictionaries/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...item, status: nextStatus })
      });
      await loadDictionaries();
      dictionaryForm.elements.type.value = selectedType;
      renderDictionaries();
      dictionaryMessage.textContent = nextStatus === "active" ? "Значение восстановлено" : "Значение скрыто";
    } catch (error) {
      dictionaryMessage.textContent = error.message;
    }
  }
});

function resetRequestList() {
  requestPage = 1;
  expandedRequestId = "";
  renderRequests();
}

searchInput.addEventListener("input", resetRequestList);
typeFilter.addEventListener("change", resetRequestList);
statusFilter.addEventListener("change", resetRequestList);
employeeSearchInput.addEventListener("input", () => {
  employeePage = 1;
  expandedEmployeeId = "";
  renderEmployees();
});
employeeStatusFilter.addEventListener("change", () => {
  employeePage = 1;
  expandedEmployeeId = "";
  renderEmployees();
});
tabButtons.forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
setupPhoneMasks();
syncDictionaryForm();
checkAuth().catch(() => {});
