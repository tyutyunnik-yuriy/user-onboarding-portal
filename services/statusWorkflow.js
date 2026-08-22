const statusLabels = {
  new: "Новая",
  in_progress: "В работе",
  approved: "Согласована",
  rejected: "Отклонена",
  done: "Выполнена"
};

const transitions = {
  new: ["in_progress", "approved", "rejected"],
  in_progress: ["approved", "rejected"],
  approved: ["done", "rejected"],
  rejected: ["in_progress"],
  done: []
};

function validateStatusTransition(currentStatus, nextStatus, { force = false } = {}) {
  if (currentStatus === nextStatus) return "";
  if (force) return "";

  const allowed = transitions[currentStatus] || [];
  if (allowed.includes(nextStatus)) return "";

  if (nextStatus === "done" && currentStatus !== "approved") {
    return 'Чтобы выполнить заявку, сначала переведите ее в статус "Согласована"';
  }

  if (currentStatus === "done") {
    return "Выполненную заявку нельзя менять без отдельного админского обхода";
  }

  return `Переход из статуса "${statusLabels[currentStatus] || currentStatus}" в "${statusLabels[nextStatus] || nextStatus}" недоступен`;
}

module.exports = {
  statusLabels,
  validateStatusTransition
};
