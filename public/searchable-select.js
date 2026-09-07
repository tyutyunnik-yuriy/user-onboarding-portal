(() => {
  const instances = new WeakMap();
  const checkboxInstances = new WeakMap();

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function normalize(value) {
    return String(value || "")
      .replace(/ё/g, "е")
      .toLowerCase();
  }

  function optionLabel(option) {
    return option ? option.textContent.trim() : "";
  }

  function selectedLabel(select) {
    const option = [...select.options].find((item) => item.value === select.value);
    return option && option.value ? optionLabel(option) : "";
  }

  function getPlaceholder(select) {
    const first = select.querySelector("option");
    return select.dataset.searchPlaceholder || optionLabel(first) || "Выберите значение";
  }

  function optionMatches(option, query) {
    if (!query) return true;
    const text = normalize(`${option.value} ${optionLabel(option)}`);
    return normalize(query)
      .split(/\s+/)
      .filter(Boolean)
      .every((token) => text.includes(token));
  }

  function close(instance) {
    instance.root.classList.remove("open");
    instance.results.innerHTML = "";
  }

  function sync(instance) {
    instance.input.value = selectedLabel(instance.select);
    instance.input.placeholder = getPlaceholder(instance.select);
    instance.input.disabled = instance.select.disabled;
    instance.root.classList.toggle("disabled", instance.select.disabled);
  }

  function render(instance) {
    const { select, input, results, root } = instance;
    if (select.disabled) {
      close(instance);
      return;
    }

    const query = input.value.trim();
    const options = [...select.options].filter((option) => {
      if (!option.value && select.required) return false;
      return optionMatches(option, query);
    });
    const visibleOptions = options.slice(0, 12);
    root.classList.add("open");
    results.innerHTML = visibleOptions.length
      ? visibleOptions
          .map(
            (option) => `
              <button class="${option.value === select.value ? "active" : ""}" type="button" data-searchable-value="${escapeHtml(option.value)}">
                ${escapeHtml(optionLabel(option))}
              </button>
            `
          )
          .join("")
      : '<p class="meta">Ничего не найдено</p>';
  }

  function enhance(select) {
    if (instances.has(select)) {
      sync(instances.get(select));
      return;
    }

    const root = document.createElement("div");
    root.className = "searchable-select";
    root.innerHTML = `
      <input type="search" autocomplete="off" />
      <div class="searchable-select-results"></div>
    `;
    select.after(root);
    select.classList.add("native-select-hidden");

    const instance = {
      select,
      root,
      input: root.querySelector("input"),
      results: root.querySelector(".searchable-select-results")
    };
    instances.set(select, instance);
    sync(instance);

    instance.input.addEventListener("focus", () => render(instance));
    instance.input.addEventListener("input", () => {
      if (instance.input.value !== selectedLabel(select)) {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      render(instance);
    });
    instance.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-searchable-value]");
      if (!button) return;
      select.value = button.dataset.searchableValue;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync(instance);
      close(instance);
    });
    select.addEventListener("change", () => {
      sync(instance);
      close(instance);
    });

    const observer = new MutationObserver(() => sync(instance));
    observer.observe(select, { attributes: true, attributeFilter: ["disabled"], childList: true, subtree: true });
  }

  document.addEventListener("click", (event) => {
    document.querySelectorAll("select[data-searchable-select]").forEach((select) => {
      const instance = instances.get(select);
      if (instance && !instance.root.contains(event.target)) close(instance);
    });
  });

  window.enhanceSearchableSelects = (scope = document) => {
    scope.querySelectorAll("select[data-searchable-select]").forEach(enhance);
    scope.querySelectorAll("[data-searchable-checkboxes]").forEach(enhanceCheckboxes);
  };

  function checkboxSearchPlaceholder(group) {
    return group.dataset.searchPlaceholder || "Найти значение";
  }

  function filterCheckboxes(instance) {
    const query = normalize(instance.input.value).trim();
    const tokens = query.split(/\s+/).filter(Boolean);
    const labels = [...instance.group.querySelectorAll("label")];
    let visibleCount = 0;

    labels.forEach((label) => {
      const visible = tokens.every((token) => normalize(label.textContent).includes(token));
      label.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    instance.emptyMessage.hidden = visibleCount > 0 || labels.length === 0 || tokens.length === 0;
  }

  function syncCheckboxes(instance) {
    instance.group.classList.add("searchable-checkbox-list");
    instance.input.placeholder = checkboxSearchPlaceholder(instance.group);
    filterCheckboxes(instance);
  }

  function enhanceCheckboxes(group) {
    if (checkboxInstances.has(group)) {
      syncCheckboxes(checkboxInstances.get(group));
      return;
    }

    const input = document.createElement("input");
    input.className = "checkbox-search-input";
    input.type = "search";
    input.autocomplete = "off";
    input.placeholder = checkboxSearchPlaceholder(group);

    const emptyMessage = document.createElement("p");
    emptyMessage.className = "meta checkbox-search-empty";
    emptyMessage.textContent = "Ничего не найдено";
    emptyMessage.hidden = true;

    group.before(input);
    group.after(emptyMessage);

    const instance = { group, input, emptyMessage };
    checkboxInstances.set(group, instance);
    syncCheckboxes(instance);

    input.addEventListener("input", () => filterCheckboxes(instance));
    const observer = new MutationObserver(() => syncCheckboxes(instance));
    observer.observe(group, { childList: true, subtree: true });
  }
})();
