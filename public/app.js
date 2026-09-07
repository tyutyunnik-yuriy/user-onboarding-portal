const form = document.querySelector("#requestForm");
const message = document.querySelector("#formMessage");
const typeInputs = [...document.querySelectorAll('input[name="requestType"]')];
const sections = [...document.querySelectorAll("[data-section]")];
const employeeSearchInputs = {
  offboarding: document.querySelector('[data-employee-search-input="offboarding"]'),
  permissions: document.querySelector('[data-employee-search-input="permissions"]')
};
const employeeSearchResults = {
  offboarding: document.querySelector('[data-employee-search-results="offboarding"]'),
  permissions: document.querySelector('[data-employee-search-results="permissions"]')
};
const selectedEmployeeSummaries = {
  offboarding: document.querySelector('[data-selected-employee-summary="offboarding"]'),
  permissions: document.querySelector('[data-selected-employee-summary="permissions"]')
};
const dictionarySelects = [...document.querySelectorAll("[data-dictionary]")];
const dictionaryCheckboxGroups = [...document.querySelectorAll("[data-checkbox-dictionary]")];
const offboardingSystemsGroup = document.querySelector("[data-employee-offboarding-systems]");
const permissionSystemsGroup = document.querySelector("[data-permission-systems]");

let employees = [];
let dictionaries = { departments: [], positions: [], subdivisions: [], managers: [], accessLevels: [], systems: [] };

function initTelegramWebApp() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  document.body.classList.add("telegram-webapp");
}

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

function selectedType() {
  return form.elements.requestType.value;
}

function syncRequestType() {
  const type = selectedType();

  sections.forEach((section) => {
    const active = section.dataset.section === type;
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((field) => {
      if (field.name === "requestType") return;
      field.disabled = !active;
      field.required = field.type !== "checkbox" && active && field.dataset.requiredFor?.split(" ").includes(type);
    });
  });
}

typeInputs.forEach((input) => input.addEventListener("change", syncRequestType));
syncRequestType();
window.enhanceSearchableSelects?.();

function fillEmployeeFields(employee) {
  if (employee?.manager && !form.elements.handoverTo.value) {
    form.elements.handoverTo.value = employee.manager;
  }
  renderSelectedEmployeeSummary("offboarding", employee);
  fillOffboardingSystems(employee);
}

function fillPermissionFields(employee) {
  if (employee?.accessLevel && !form.elements.requestedAccessLevel.value) {
    form.elements.requestedAccessLevel.value = "";
  }
  renderSelectedEmployeeSummary("permissions", employee);
  fillPermissionSystems(employee);
}

function optionHtml(item) {
  const value = typeof item === "string" ? item : item.value;
  return `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`;
}

function setSelectOptions(select, items) {
  const first = select.querySelector("option")?.outerHTML || '<option value="">Выберите</option>';
  const current = select.value;
  select.innerHTML = first + items.map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function mergeManagersFromEmployees() {
  const employeeManagers = employees
    .filter((employee) => employee.isDepartmentManager)
    .map((employee) => ({
      id: `employee-manager-${employee.id}`,
      type: "managers",
      value: employee.fullName,
      metadata: {
        employeeId: employee.id,
        phone: employee.phone || "",
        subdivisions: employee.managedSubdivisions?.length ? employee.managedSubdivisions : [employee.subdivision || employee.department || ""].filter(Boolean),
        subdivision: employee.subdivision || employee.department || "",
        telegramChatId: employee.telegramChatId || ""
      },
      status: "active"
    }));

  const employeeManagerKeys = new Set(employeeManagers.map((item) => String(item.value || "").trim().toLowerCase()));
  const manualManagers = (dictionaries.managers || []).filter((item) => !employeeManagerKeys.has(String(item.value || "").trim().toLowerCase()));
  dictionaries.managers = [...manualManagers, ...employeeManagers];
}

function fillDictionarySelects() {
  dictionarySelects.forEach((select) => {
    if (select.dataset.dictionary === "positions") return;
    setSelectOptions(select, dictionaries[select.dataset.dictionary] || []);
  });
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

function fillDepartmentSelect(selected = form.elements.department.value) {
  const select = form.elements.department;
  const first = '<option value="">Выберите отдел</option>';
  const values = departmentsForSubdivision(form.elements.subdivision.value);
  select.innerHTML = first + values.map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function fillPositionSelect(selected = form.elements.position.value) {
  const select = form.elements.position;
  const first = select.querySelector("option")?.outerHTML || '<option value="">Выберите должность</option>';
  const values = positionsForDepartment(form.elements.department.value);
  select.innerHTML = first + values.map(optionHtml).join("");
  if ([...select.options].some((option) => option.value === selected)) {
    select.value = selected;
  }
}

function fillOnboardingSystems() {
  const targetSubdivision = form.elements.subdivision.value || form.elements.department.value;
  dictionaryCheckboxGroups.forEach((group) => {
    const items =
      group.dataset.checkboxDictionary === "systems"
        ? systemsForSubdivision(targetSubdivision)
        : dictionaries[group.dataset.checkboxDictionary] || [];
    setCheckboxOptions(group, items);
  });
}

function checkboxHtml(item, name, requiredFor, checked = false) {
  const value = typeof item === "string" ? item : item.value;
  return `
    <label>
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" data-required-for="${escapeHtml(requiredFor)}" ${
        checked ? "checked" : ""
      } />
      ${escapeHtml(value)}
    </label>
  `;
}

function setCheckboxOptions(group, items) {
  const name = group.dataset.checkboxName;
  const requiredFor = group.dataset.requiredFor || "";
  group.innerHTML = items.length
    ? items.map((item) => checkboxHtml(item, name, requiredFor)).join("")
    : '<p class="meta">В справочнике пока нет активных значений</p>';
}

function findManagerForDepartment(subdivision, department) {
  const normalizedSubdivision = String(subdivision || "").trim().toLowerCase();
  const normalizedDepartment = String(department || "").trim().toLowerCase();
  if (!normalizedSubdivision || !normalizedDepartment) return null;
  const employeeManagers = employees
    .filter((employee) => employee.isDepartmentManager)
    .map((employee) => ({
      id: `employee-manager-${employee.id}`,
      type: "managers",
      value: employee.fullName,
      metadata: {
        employeeId: employee.id,
        department: employee.department || "",
        subdivisions: employee.managedSubdivisions?.length ? employee.managedSubdivisions : [employee.subdivision || employee.department || ""].filter(Boolean),
        subdivision: employee.subdivision || employee.department || ""
      },
      status: "active"
    }));
  const managers = (dictionaries.managers || []).filter((item) => item.status !== "archived");
  const allManagers = [...employeeManagers, ...managers];
  const managerMatchesBusinessUnit = (item) => {
    const managerSubdivisions = metadataSubdivisions(item.metadata).map((entry) => entry.toLowerCase());
    return (
      managerSubdivisions.includes(normalizedSubdivision) ||
      String(item.metadata?.subdivision || "").trim().toLowerCase() === normalizedSubdivision
    );
  };
  const managerMatchesDepartment = (item) => {
    const employee = employees.find((entry) => entry.id === item.metadata?.employeeId);
    const managerDepartment = String(employee?.department || item.metadata?.department || "").trim().toLowerCase();
    return managerDepartment === normalizedDepartment;
  };

  return allManagers.find((item) => managerMatchesBusinessUnit(item) && managerMatchesDepartment(item)) || null;
}

function syncManagerByDepartment() {
  if (selectedType() !== "onboarding") return;
  const manager = findManagerForDepartment(form.elements.subdivision.value, form.elements.department.value);
  form.elements.manager.value = manager ? manager.value : "";
}

function fillOffboardingSystems(employee) {
  const systems = employee?.systems || [];
  offboardingSystemsGroup.innerHTML = systems.length
    ? `
        <p class="meta full-row">Эти сервисы будут переданы администратору как справка для отключения доступов.</p>
        ${systems.map((system) => `<span class="info-chip">${escapeHtml(system)}</span>`).join("")}
      `
    : '<p class="meta full-row">Выберите сотрудника, чтобы увидеть его текущие системы</p>';
}

function fillPermissionSystems(employee) {
  const currentSystems = employee?.systems || [];
  const current = new Set(currentSystems);
  const allSystems = systemsForSubdivision(employee?.subdivision || employee?.department || "");
  const allowed = new Set(allSystems.map((item) => item.value));
  const currentOutsideSubdivision = currentSystems
    .filter((value) => !allowed.has(value))
    .map((value) => ({ value, metadata: { subdivision: "уже назначено" }, status: "active" }));
  const visibleSystems = [...allSystems, ...currentOutsideSubdivision];

  if (!employee) {
    permissionSystemsGroup.innerHTML = '<p class="meta">Выберите сотрудника, чтобы увидеть доступные системы</p>';
    return;
  }

  permissionSystemsGroup.innerHTML = visibleSystems.length
    ? visibleSystems.map((system) => checkboxHtml(system, "requestedSystems", "permissions", current.has(system.value))).join("")
    : '<p class="meta">В справочнике систем пока нет активных значений</p>';
}

async function loadDictionaries() {
  try {
    const response = await fetch("/api/dictionaries");
    const result = await response.json();
    dictionaries = result.dictionaries || dictionaries;
    mergeManagersFromEmployees();
    fillDictionarySelects();
    fillDepartmentSelect();
    fillPositionSelect();
    fillOnboardingSystems();
    syncManagerByDepartment();
    syncRequestType();
    window.enhanceSearchableSelects?.();
  } catch {
    message.textContent = "Не удалось загрузить справочники";
  }
}

async function loadEmployees() {
  try {
    const response = await fetch("/api/users");
    const result = await response.json();
    employees = result.users || [];
    renderEmployeeSearchResults("offboarding");
    renderEmployeeSearchResults("permissions");
    mergeManagersFromEmployees();
    fillDictionarySelects();
    syncManagerByDepartment();
    window.enhanceSearchableSelects?.();
  } catch {
    message.textContent = "Не удалось загрузить список сотрудников";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .replace(/ё/g, "е")
    .toLowerCase();
}

function employeeSearchText(employee) {
  return [
    employee.fullName,
    employee.lastName,
    employee.firstName,
    employee.middleName,
    employee.email,
    employee.phone,
    employee.department,
    employee.subdivision,
    employee.position,
    employee.manager,
    ...(employee.systems || [])
  ]
    .filter(Boolean)
    .join(" ")
    .concat(" ", String(employee.phone || "").replace(/\D/g, ""))
    .toLowerCase()
    .replace(/ё/g, "е");
}

function employeeSearchRank(employee, tokens) {
  const fields = {
    fullName: normalizeSearch(employee.fullName),
    lastName: normalizeSearch(employee.lastName),
    firstName: normalizeSearch(employee.firstName),
    middleName: normalizeSearch(employee.middleName),
    email: normalizeSearch(employee.email),
    phoneDigits: String(employee.phone || "").replace(/\D/g, ""),
    department: normalizeSearch(employee.department),
    subdivision: normalizeSearch(employee.subdivision),
    position: normalizeSearch(employee.position),
    manager: normalizeSearch(employee.manager),
    systems: normalizeSearch((employee.systems || []).join(" "))
  };
  const allText = employeeSearchText(employee);

  return tokens.reduce((score, token) => {
    const digits = token.replace(/\D/g, "");
    if (fields.lastName.startsWith(token)) return score + 1200;
    if (fields.fullName.startsWith(token)) return score + 1100;
    if (fields.fullName.split(/\s+/).some((part) => part.startsWith(token))) return score + 1000;
    if (fields.email.startsWith(token)) return score + 900;
    if (digits && fields.phoneDigits.startsWith(digits)) return score + 850;
    if (fields.email.includes(token)) return score + 650;
    if (fields.department.startsWith(token) || fields.subdivision.startsWith(token)) return score + 450;
    if (fields.position.startsWith(token) || fields.manager.startsWith(token)) return score + 350;
    if (allText.includes(token)) return score + 150;
    if (digits && allText.includes(digits)) return score + 120;
    return score;
  }, 0);
}

function employeeSearchLabel(employee) {
  return `${employee.fullName} · ${employee.email || "без почты"}`;
}

function renderSelectedEmployeeSummary(kind, employee) {
  const summary = selectedEmployeeSummaries[kind];
  if (!summary) return;
  summary.classList.toggle("hidden", !employee);
  summary.innerHTML = employee
    ? `
        <strong>${escapeHtml(employee.fullName)}</strong>
        <span>${escapeHtml(employee.email || "почта не указана")}</span>
        <span>${escapeHtml(employee.department || "отдел не указан")} · ${escapeHtml(employee.subdivision || "бизнес-юнит не указан")}</span>
        <span>Руководитель: ${escapeHtml(employee.manager || "не указан")}</span>
        ${kind === "permissions" ? `<span>Текущий доступ: ${escapeHtml(employee.accessLevel || "не назначен")}</span>` : ""}
      `
    : "";
}

function renderEmployeeSearchResults(kind) {
  const input = employeeSearchInputs[kind];
  const results = employeeSearchResults[kind];
  if (!input || !results) return;

  const query = normalizeSearch(input.value.trim());
  const selectedId = kind === "offboarding" ? form.elements.employeeId.value : form.elements.permissionEmployeeId.value;
  if (selectedId) {
    results.innerHTML = "";
    return;
  }
  if (!employees.length) {
    results.innerHTML = '<p class="meta">Сотрудников в базе пока нет</p>';
    return;
  }
  if (!query) {
    results.innerHTML = '<p class="meta">Начните вводить ФИО, почту, отдел или бизнес-юнит</p>';
    return;
  }

  const tokens = query.split(/\s+/).filter(Boolean);
  const matches = employees
    .filter((employee) => {
      const text = employeeSearchText(employee);
      return tokens.every((token) => {
        const digits = token.replace(/\D/g, "");
        return text.includes(token) || (digits && text.includes(digits));
      });
    })
    .sort((left, right) => employeeSearchRank(right, tokens) - employeeSearchRank(left, tokens))
    .slice(0, 10);
  results.innerHTML = matches.length
    ? matches
        .map(
          (employee) => `
            <button class="employee-search-result ${employee.id === selectedId ? "active" : ""}" type="button" data-select-employee="${escapeHtml(employee.id)}" data-employee-search-kind="${escapeHtml(kind)}">
              <strong>${escapeHtml(employee.fullName)}</strong>
              <span>${escapeHtml(employee.email || "без почты")} · ${escapeHtml(employee.department || "без отдела")} · ${escapeHtml(employee.subdivision || "без бизнес-юнита")}</span>
            </button>
          `
        )
        .join("")
    : '<p class="meta">Ничего не найдено. Уточните ФИО, почту или отдел.</p>';
}

function selectEmployeeForRequest(kind, employee) {
  if (kind === "offboarding") {
    form.elements.employeeId.value = employee?.id || "";
    employeeSearchInputs.offboarding.value = employee ? employeeSearchLabel(employee) : "";
    fillEmployeeFields(employee);
  } else {
    form.elements.permissionEmployeeId.value = employee?.id || "";
    employeeSearchInputs.permissions.value = employee ? employeeSearchLabel(employee) : "";
    fillPermissionFields(employee);
  }
  if (employeeSearchResults[kind]) employeeSearchResults[kind].innerHTML = "";
}

Object.entries(employeeSearchInputs).forEach(([kind, input]) => {
  if (!input) return;
  input.addEventListener("input", () => {
    if (kind === "offboarding") {
      form.elements.employeeId.value = "";
      fillEmployeeFields(null);
    } else {
      form.elements.permissionEmployeeId.value = "";
      fillPermissionFields(null);
    }
    renderEmployeeSearchResults(kind);
  });
  input.addEventListener("focus", () => renderEmployeeSearchResults(kind));
});

Object.values(employeeSearchResults).forEach((results) => {
  if (!results) return;
  results.addEventListener("click", (event) => {
    const button = event.target.closest("[data-select-employee]");
    if (!button) return;
    const employee = employees.find((item) => item.id === button.dataset.selectEmployee);
    selectEmployeeForRequest(button.dataset.employeeSearchKind, employee);
  });
});

form.elements.department.addEventListener("change", () => {
  fillPositionSelect("");
  syncManagerByDepartment();
  fillOnboardingSystems();
});

form.elements.subdivision.addEventListener("change", () => {
  fillDepartmentSelect("");
  fillPositionSelect("");
  syncManagerByDepartment();
  fillOnboardingSystems();
});

loadEmployees();
loadDictionaries();
fillOffboardingSystems(null);
fillPermissionSystems(null);
setupPhoneMasks();
initTelegramWebApp();

function validateChoiceGroups(payload) {
  if (payload.requestType === "onboarding" && payload.systems.length === 0) {
    return "Выберите хотя бы одну необходимую систему";
  }

  if (
    payload.requestType === "permissions" &&
    !payload.permissionsSystemsChanged &&
    !payload.requestedAccessLevel
  ) {
    return "Выберите, какие права нужно изменить";
  }

  return "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Отправляем...";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.systems = formData.getAll("systems");
  payload.offboardingActions = formData.getAll("offboardingActions");
  payload.systemsToAdd = formData.getAll("systemsToAdd");
  payload.systemsToRemove = formData.getAll("systemsToRemove");
  payload.requestedSystems = formData.getAll("requestedSystems");

  if (payload.requestType === "permissions") {
    const employee = employees.find((item) => item.id === payload.permissionEmployeeId);
    if (!employee) {
      message.textContent = "Выберите сотрудника из найденных результатов";
      return;
    }
    const currentSystems = employee?.systems || [];
    const requestedSystems = payload.requestedSystems || [];
    payload.employeeId = payload.permissionEmployeeId;
    payload.systemsToAdd = requestedSystems.filter((system) => !currentSystems.includes(system));
    payload.systemsToRemove = currentSystems.filter((system) => !requestedSystems.includes(system));
    payload.permissionsSystemsChanged = payload.systemsToAdd.length > 0 || payload.systemsToRemove.length > 0;
  }

  if (payload.requestType === "offboarding") {
    const employee = employees.find((item) => item.id === payload.employeeId);
    if (!employee) {
      message.textContent = "Выберите сотрудника из найденных результатов";
      return;
    }
    payload.offboardingActions = [];
  }

  const choiceError = validateChoiceGroups(payload);
  if (choiceError) {
    message.textContent = choiceError;
    return;
  }

  form.querySelectorAll("[data-mirror-to]:not(:disabled)").forEach((field) => {
    payload[field.dataset.mirrorTo] = field.value;
  });

  let response;
  let result;
  try {
    response = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    result = await response.json();
  } catch {
    message.textContent = "Сервер не отвечает. Проверьте, что приложение запущено.";
    return;
  }

  if (!response.ok) {
    message.textContent = result.errors?.join(". ") || result.error || "Не удалось отправить заявку";
    return;
  }

  form.reset();
  fillEmployeeFields(null);
  fillPermissionFields(null);
  renderEmployeeSearchResults("offboarding");
  renderEmployeeSearchResults("permissions");
  syncRequestType();
  message.textContent = `Заявка создана. Номер: ${result.item.id.slice(0, 8)}`;
});
