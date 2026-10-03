/**
 * Newvora HQ - Frontend Logic (Vanilla JS)
 */

// View metadata for page headers
const VIEW_METADATA = {
  inbox: {
    title: "Inbox",
    description: "Turn incoming WhatsApp requests into actionable tasks."
  },
  board: {
    title: "Board",
    description: "Manage client website deliverables across stages."
  },
  clients: {
    title: "Clients",
    description: "Directory of active client retainers, portals, and terms."
  },
  money: {
    title: "Money",
    description: "Track monthly income, software expenses, and net margin."
  },
  activity: {
    title: "Activity",
    description: "Audit log of recent team actions and status updates."
  }
};

// Application State
const state = {
  currentView: "inbox",
  members: [],
  clients: [],
  tasks: [],
  inboxImage: null,
  activeMemberId: null,
  activeMemberName: "Guest",
  selectedClientId: null,
  boardFilterClient: "all",
  boardFilterAssignee: "all",
  selectedFinanceMonth: "2026-10",
  appInitialized: false
};

// ==============================================================================
// Security: XSS Prevention Utility
// ==============================================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(isoStr) {
  if (!isoStr) return "-";
  try {
    const d = new Date(isoStr.replace(" ", "T"));
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return isoStr;
  }
}

// ==============================================================================
// Navigation Handling
// ==============================================================================
function navigateTo(viewName) {
  if (!VIEW_METADATA[viewName]) {
    viewName = "inbox";
  }
  state.currentView = viewName;

  // Update URL hash without jumping
  if (window.location.hash !== `#${viewName}`) {
    history.replaceState(null, "", `#${viewName}`);
  }

  // Update navigation link active classes
  document.querySelectorAll(".nav-link").forEach((link) => {
    if (link.dataset.view === viewName) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });

  // Switch view panes
  document.querySelectorAll(".view-pane").forEach((pane) => {
    pane.classList.remove("active");
  });
  const targetPane = document.getElementById(`view-${viewName}`);
  if (targetPane) {
    targetPane.classList.add("active");
  }

  // Update header text
  const meta = VIEW_METADATA[viewName];
  document.getElementById("pageTitle").textContent = meta.title;
  document.getElementById("pageDescription").textContent = meta.description;

  // Trigger view data refreshes
  if (viewName === "board") {
    loadBoard();
  } else if (viewName === "clients") {
    loadClientsView();
  } else if (viewName === "money") {
    loadFinances();
  } else if (viewName === "activity") {
    loadActivityFeed();
  } else if (viewName === "inbox") {
    loadClients();
  }

  // Close mobile sidebar if open
  const sidebar = document.getElementById("sidebar");
  if (sidebar && sidebar.classList.contains("mobile-open")) {
    sidebar.classList.remove("mobile-open");
  }
}

// ==============================================================================
// Member Management ("Who are you?")
// ==============================================================================
async function loadMembers() {
  try {
    const res = await fetch("/api/members");
    if (!res.ok) throw new Error("Failed to load members");
    state.members = await res.json();
    renderMemberSelect();
    renderBoardAssigneeFilter();
  } catch (err) {
    console.error("Error loading members:", err);
  }
}

function renderMemberSelect() {
  const select = document.getElementById("memberSelect");
  const storedMemberId = localStorage.getItem("newvora_member_id");

  select.innerHTML = '<option value="" disabled>Select your name</option>';

  let matched = false;
  state.members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.role})`;
    if (storedMemberId && String(m.id) === String(storedMemberId)) {
      opt.selected = true;
      matched = true;
      state.activeMemberId = m.id;
      state.activeMemberName = m.name;
    }
    select.appendChild(opt);
  });

  // Default to first member if none selected or stored
  if (!matched && state.members.length > 0) {
    select.value = state.members[0].id;
    state.activeMemberId = state.members[0].id;
    state.activeMemberName = state.members[0].name;
    localStorage.setItem("newvora_member_id", state.members[0].id);
  }

  updateActiveMemberDisplay();
}

function updateActiveMemberDisplay() {
  const display = document.getElementById("activeMemberName");
  if (display) {
    display.textContent = state.activeMemberName || "Guest";
  }
}

function handleMemberChange(e) {
  const selectedId = parseInt(e.target.value, 10);
  const found = state.members.find((m) => m.id === selectedId);
  if (found) {
    state.activeMemberId = found.id;
    state.activeMemberName = found.name;
    localStorage.setItem("newvora_member_id", found.id);
    updateActiveMemberDisplay();
  }
}

async function handleSaveNewMember() {
  const nameInput = document.getElementById("newMemberName");
  const roleInput = document.getElementById("newMemberRole");
  const errorDiv = document.getElementById("memberErrorMsg");

  const name = nameInput.value.trim();
  const role = roleInput.value.trim() || "Team Member";

  if (!name) {
    errorDiv.textContent = "Please enter a name.";
    errorDiv.classList.remove("hidden");
    return;
  }

  try {
    errorDiv.classList.add("hidden");
    const res = await fetch("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Could not save member.");
    }

    const created = await res.json();
    nameInput.value = "";
    roleInput.value = "";
    document.getElementById("addMemberForm").classList.add("hidden");

    await loadMembers();
    state.activeMemberId = created.id;
    state.activeMemberName = created.name;
    localStorage.setItem("newvora_member_id", created.id);
    document.getElementById("memberSelect").value = created.id;
    updateActiveMemberDisplay();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

// ==============================================================================
// Clients Loading & Management (Stage 3 + Stage 6)
// ==============================================================================
async function loadClients() {
  try {
    const res = await fetch("/api/clients");
    if (!res.ok) throw new Error("Failed to load clients");
    state.clients = await res.json();
    renderInboxClients();
    renderBoardClientFilter();
    renderIncomeClientSelect();
  } catch (err) {
    console.error("Error loading clients:", err);
  }
}

function renderInboxClients() {
  const select = document.getElementById("inboxClientSelect");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="" disabled selected>Select a client...</option>';
  state.clients.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.company})`;
    select.appendChild(opt);
  });

  if (currentVal && state.clients.some((c) => String(c.id) === String(currentVal))) {
    select.value = currentVal;
  } else if (state.clients.length > 0) {
    select.value = state.clients[0].id;
  }
}

async function loadClientsView() {
  await loadClients();
  document.getElementById("clientsListPane").classList.remove("hidden");
  document.getElementById("clientDetailPane").classList.add("hidden");
  renderClientsTable();
}

function renderClientsTable() {
  const tbody = document.getElementById("clientsTableBody");
  if (!tbody) return;

  if (state.clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">No clients yet. Click "+ Add client" above.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  state.clients.forEach((client) => {
    const tr = document.createElement("tr");
    tr.className = "clickable-row";

    const feeFormatted = client.monthly_fee ? `$${Number(client.monthly_fee).toFixed(0)}/mo` : "$0/mo";
    const activeTasks = client.active_task_count || 0;

    tr.innerHTML = `
      <td><strong>${escapeHtml(client.name)}</strong></td>
      <td>${escapeHtml(client.company)}</td>
      <td><span class="badge badge-status">${escapeHtml(client.plan_name)}</span></td>
      <td><strong>${feeFormatted}</strong></td>
      <td>${escapeHtml(client.contract_end_date || "-")}</td>
      <td><span class="badge ${activeTasks > 0 ? "badge-status-doing" : "badge-status"}">${activeTasks} active</span></td>
      <td class="text-right">
        <button type="button" class="btn btn-secondary btn-sm btn-view-client" data-id="${client.id}">View</button>
        <button type="button" class="btn btn-secondary btn-sm btn-edit-client ml-2" data-id="${client.id}">Edit</button>
      </td>
    `;

    tr.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openClientDetail(client.id);
    });

    const btnView = tr.querySelector(".btn-view-client");
    btnView.addEventListener("click", (e) => {
      e.stopPropagation();
      openClientDetail(client.id);
    });

    const btnEdit = tr.querySelector(".btn-edit-client");
    btnEdit.addEventListener("click", (e) => {
      e.stopPropagation();
      openEditClientForm(client);
    });

    tbody.appendChild(tr);
  });
}

async function openClientDetail(clientId) {
  state.selectedClientId = clientId;
  const listPane = document.getElementById("clientsListPane");
  const detailPane = document.getElementById("clientDetailPane");
  document.getElementById("weeklyUpdateCard").classList.add("hidden");

  try {
    const res = await fetch(`/api/clients/${clientId}`);
    if (!res.ok) throw new Error("Failed to load client details");
    const data = await res.json();
    const c = data.client;
    const tasks = data.tasks || [];

    document.getElementById("detailClientName").textContent = c.name;
    document.getElementById("detailClientCompany").textContent = c.company;
    document.getElementById("detailClientFee").textContent = c.monthly_fee ? `$${Number(c.monthly_fee).toFixed(0)}/mo` : "$0/mo";
    document.getElementById("detailClientPlan").textContent = c.plan_name;
    document.getElementById("detailClientEndDate").textContent = c.contract_end_date || "Open-ended / Retainer";
    document.getElementById("detailClientNotes").textContent = c.notes || "No notes recorded.";
    document.getElementById("detailTasksCount").textContent = `${tasks.length} total tasks`;

    renderClientDetailTasks(tasks);

    listPane.classList.add("hidden");
    detailPane.classList.remove("hidden");
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function renderClientDetailTasks(tasks) {
  const tbody = document.getElementById("detailTasksTableBody");
  if (!tbody) return;

  if (tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted text-center py-4">No tasks found for this client.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  tasks.forEach((t) => {
    const tr = document.createElement("tr");

    let statusBadge = "badge-status";
    if (t.status === "doing") statusBadge = "badge-status-doing";
    if (t.status === "done") statusBadge = "badge-status-done";

    let prioBadge = "badge-prio-low";
    if (t.priority === "high") prioBadge = "badge-prio-high";
    if (t.priority === "medium") prioBadge = "badge-prio-medium";

    tr.innerHTML = `
      <td><span class="badge ${statusBadge}">${escapeHtml(t.status.toUpperCase())}</span></td>
      <td><span class="badge ${prioBadge}">${escapeHtml(t.priority.toUpperCase())}</span></td>
      <td><span class="badge badge-type">${escapeHtml(t.request_type)}</span></td>
      <td>
        <strong>${escapeHtml(t.title)}</strong>
        ${t.description ? `<div class="card-desc mt-1">${escapeHtml(t.description)}</div>` : ""}
      </td>
      <td>${escapeHtml(t.member_name || "Unassigned")}</td>
      <td><span class="text-muted">${formatDate(t.created_at)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function setupClientFormHandlers() {
  const btnOpenAdd = document.getElementById("btnOpenAddClient");
  const formCard = document.getElementById("clientFormCard");
  const form = document.getElementById("clientForm");
  const btnCancel = document.getElementById("btnCancelClient");
  const btnBackToClients = document.getElementById("btnBackToClients");
  const btnEditCurrentClient = document.getElementById("btnEditCurrentClient");
  const btnWeeklyUpdateAI = document.getElementById("btnWeeklyUpdateAI");
  const btnCloseWeeklyUpdate = document.getElementById("btnCloseWeeklyUpdate");
  const btnCopyWeeklyUpdate = document.getElementById("btnCopyWeeklyUpdate");

  if (btnOpenAdd) {
    btnOpenAdd.addEventListener("click", () => {
      document.getElementById("editClientId").value = "";
      document.getElementById("clientFormTitle").textContent = "Add Client";
      form.reset();
      document.getElementById("clientFormPlan").value = "Standard Retainer";
      document.getElementById("clientFormFee").value = "350";
      document.getElementById("clientFormError").classList.add("hidden");
      formCard.classList.remove("hidden");
      document.getElementById("clientFormName").focus();
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      formCard.classList.add("hidden");
      document.getElementById("clientFormError").classList.add("hidden");
    });
  }

  if (btnBackToClients) {
    btnBackToClients.addEventListener("click", () => {
      document.getElementById("clientDetailPane").classList.add("hidden");
      document.getElementById("clientsListPane").classList.remove("hidden");
      loadClientsTable();
    });
  }

  if (btnEditCurrentClient) {
    btnEditCurrentClient.addEventListener("click", () => {
      const client = state.clients.find((c) => c.id === state.selectedClientId);
      if (client) {
        document.getElementById("clientDetailPane").classList.add("hidden");
        document.getElementById("clientsListPane").classList.remove("hidden");
        openEditClientForm(client);
      }
    });
  }

  // Stage 6: Weekly Client Update
  if (btnWeeklyUpdateAI) {
    btnWeeklyUpdateAI.addEventListener("click", handleGenerateWeeklyUpdate);
  }

  if (btnCloseWeeklyUpdate) {
    btnCloseWeeklyUpdate.addEventListener("click", () => {
      document.getElementById("weeklyUpdateCard").classList.add("hidden");
    });
  }

  if (btnCopyWeeklyUpdate) {
    btnCopyWeeklyUpdate.addEventListener("click", () => {
      const text = document.getElementById("weeklyUpdateText").value;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const feedback = document.getElementById("copyFeedback");
        feedback.classList.remove("hidden");
        setTimeout(() => feedback.classList.add("hidden"), 2000);
      });
    });
  }

  if (form) {
    form.addEventListener("submit", handleSaveClient);
  }
}

async function handleGenerateWeeklyUpdate() {
  if (!state.selectedClientId) return;
  const card = document.getElementById("weeklyUpdateCard");
  const loading = document.getElementById("weeklyUpdateLoading");
  const textarea = document.getElementById("weeklyUpdateText");
  const content = document.getElementById("weeklyUpdateContent");

  card.classList.remove("hidden");
  loading.classList.remove("hidden");
  content.classList.add("hidden");

  try {
    const res = await fetch("/api/ai/weekly-update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getStoredAccessCode()
      },
      body: JSON.stringify({ client_id: state.selectedClientId })
    });

    if (res.status === 401) {
      showAccessGate("Access passcode required or invalid. Please unlock workspace.");
      card.classList.add("hidden");
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to generate update.");

    textarea.value = data.message;
    content.classList.remove("hidden");
  } catch (err) {
    alert("Error drafting weekly update: " + err.message);
    card.classList.add("hidden");
  } finally {
    loading.classList.add("hidden");
  }
}

function openEditClientForm(client) {
  const formCard = document.getElementById("clientFormCard");
  document.getElementById("editClientId").value = client.id;
  document.getElementById("clientFormTitle").textContent = `Edit Client: ${client.name}`;
  document.getElementById("clientFormName").value = client.name || "";
  document.getElementById("clientFormCompany").value = client.company || "";
  document.getElementById("clientFormPlan").value = client.plan_name || "Standard Retainer";
  document.getElementById("clientFormFee").value = client.monthly_fee || 0;
  document.getElementById("clientFormEndDate").value = client.contract_end_date || "";
  document.getElementById("clientFormNotes").value = client.notes || "";
  document.getElementById("clientFormError").classList.add("hidden");

  formCard.classList.remove("hidden");
  formCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function handleSaveClient(e) {
  e.preventDefault();
  const editId = document.getElementById("editClientId").value;
  const name = document.getElementById("clientFormName").value.trim();
  const company = document.getElementById("clientFormCompany").value.trim();
  const plan_name = document.getElementById("clientFormPlan").value.trim() || "Standard Retainer";
  const monthly_fee = parseFloat(document.getElementById("clientFormFee").value) || 0;
  const contract_end_date = document.getElementById("clientFormEndDate").value.trim();
  const notes = document.getElementById("clientFormNotes").value.trim();
  const errorDiv = document.getElementById("clientFormError");

  const payload = {
    name,
    company,
    plan_name,
    monthly_fee,
    contract_end_date,
    notes,
    creator_name: state.activeMemberName,
    updater_name: state.activeMemberName
  };

  try {
    errorDiv.classList.add("hidden");
    let url = "/api/clients";
    let method = "POST";
    if (editId) {
      url = `/api/clients/${editId}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to save client.");
    }

    document.getElementById("clientFormCard").classList.add("hidden");
    await loadClientsView();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

// ==============================================================================
// Kanban Board & Task Controls (Stage 4)
// ==============================================================================
async function loadBoard() {
  await Promise.all([loadMembers(), loadClients()]);
  await loadBoardTasks();
}

function renderBoardClientFilter() {
  const select = document.getElementById("boardFilterClient");
  if (!select) return;

  const currentVal = state.boardFilterClient;
  select.innerHTML = '<option value="all">All Clients</option>';
  state.clients.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name}`;
    if (String(c.id) === String(currentVal)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function renderBoardAssigneeFilter() {
  const select = document.getElementById("boardFilterAssignee");
  if (!select) return;

  const currentVal = state.boardFilterAssignee;
  select.innerHTML = '<option value="all">All Members</option>';
  state.members.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name}`;
    if (String(m.id) === String(currentVal)) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

async function loadBoardTasks() {
  try {
    const res = await fetch("/api/tasks");
    if (!res.ok) throw new Error("Failed to load tasks");
    state.tasks = await res.json();
    renderBoardColumns();
  } catch (err) {
    console.error("Error loading board tasks:", err);
  }
}

function renderBoardColumns() {
  const colTodo = document.getElementById("cards-todo");
  const colDoing = document.getElementById("cards-doing");
  const colDone = document.getElementById("cards-done");

  const countTodo = document.getElementById("count-todo");
  const countDoing = document.getElementById("count-doing");
  const countDone = document.getElementById("count-done");

  colTodo.innerHTML = "";
  colDoing.innerHTML = "";
  colDone.innerHTML = "";

  const filtered = state.tasks.filter((t) => {
    if (state.boardFilterClient !== "all" && String(t.client_id) !== String(state.boardFilterClient)) {
      return false;
    }
    if (state.boardFilterAssignee !== "all" && String(t.assigned_member_id) !== String(state.boardFilterAssignee)) {
      return false;
    }
    return true;
  });

  const todoTasks = filtered.filter((t) => t.status === "todo");
  const doingTasks = filtered.filter((t) => t.status === "doing");
  const doneTasks = filtered.filter((t) => t.status === "done");

  countTodo.textContent = todoTasks.length;
  countDoing.textContent = doingTasks.length;
  countDone.textContent = doneTasks.length;

  if (todoTasks.length === 0) {
    colTodo.innerHTML = '<div class="empty-col-message">No tasks to do</div>';
  } else {
    todoTasks.forEach((t) => colTodo.appendChild(createBoardTaskCard(t)));
  }

  if (doingTasks.length === 0) {
    colDoing.innerHTML = '<div class="empty-col-message">No active tasks in progress</div>';
  } else {
    doingTasks.forEach((t) => colDoing.appendChild(createBoardTaskCard(t)));
  }

  if (doneTasks.length === 0) {
    colDone.innerHTML = '<div class="empty-col-message">No completed tasks</div>';
  } else {
    doneTasks.forEach((t) => colDone.appendChild(createBoardTaskCard(t)));
  }
}

function createBoardTaskCard(task) {
  const card = document.createElement("div");
  card.className = "board-card";
  card.id = `board-card-${task.id}`;

  let prioBadge = "badge-prio-low";
  if (task.priority === "high") prioBadge = "badge-prio-high";
  if (task.priority === "medium") prioBadge = "badge-prio-medium";

  const memberOptions = [
    '<option value="">Unassigned</option>',
    ...state.members.map((m) => `<option value="${m.id}" ${m.id === task.assigned_member_id ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
  ].join("");

  let actionButtonsHtml = "";
  if (task.status === "todo") {
    actionButtonsHtml = `<button type="button" class="btn btn-primary btn-sm btn-move" data-id="${task.id}" data-status="doing">Start &rarr;</button>`;
  } else if (task.status === "doing") {
    actionButtonsHtml = `
      <button type="button" class="btn btn-secondary btn-sm btn-move" data-id="${task.id}" data-status="todo">&larr; Todo</button>
      <button type="button" class="btn btn-primary btn-sm btn-move ml-1" data-id="${task.id}" data-status="done">Done &rarr;</button>
    `;
  } else if (task.status === "done") {
    actionButtonsHtml = `<button type="button" class="btn btn-secondary btn-sm btn-move" data-id="${task.id}" data-status="doing">Reopen</button>`;
  }

  const hasClarifying = Boolean(task.clarifying_question && task.clarifying_question.trim());

  card.innerHTML = `
    <div class="card-top-meta">
      <span class="card-client-name">${escapeHtml(task.client_name || "Client")}</span>
      <div class="card-badges">
        <span class="badge ${prioBadge}">${escapeHtml(task.priority.toUpperCase())}</span>
        <span class="badge badge-type">${escapeHtml(task.request_type)}</span>
      </div>
    </div>

    <div class="card-title">${escapeHtml(task.title)}</div>
    ${task.description ? `<div class="card-desc">${escapeHtml(task.description)}</div>` : ""}

    ${
      hasClarifying
        ? `
        <div class="card-clarifying">
          <strong>Clarifying question:</strong>
          ${escapeHtml(task.clarifying_question)}
        </div>
        `
        : ""
    }

    <div class="card-footer">
      <select class="form-select form-select-sm card-assignee-select" data-id="${task.id}">
        ${memberOptions}
      </select>
      <div class="card-actions">
        ${actionButtonsHtml}
      </div>
    </div>

    <!-- Comments Toggle & Drawer -->
    <div class="mt-1">
      <button type="button" class="card-comments-toggle" data-id="${task.id}">
        Comments (${task.comment_count || 0})
      </button>
      <div class="card-comments-drawer hidden" id="comments-drawer-${task.id}">
        <div class="comments-list" id="comments-list-${task.id}">
          <div class="text-muted text-center" style="font-size: 11px;">Loading comments...</div>
        </div>
        <form class="comment-form" data-id="${task.id}">
          <input type="text" class="form-input comment-input" placeholder="Write a comment..." required />
          <button type="submit" class="btn btn-secondary btn-sm">Post</button>
        </form>
      </div>
    </div>
  `;

  card.querySelectorAll(".btn-move").forEach((btn) => {
    btn.addEventListener("click", () => handleMoveTask(task.id, btn.dataset.status));
  });

  const selectAssign = card.querySelector(".card-assignee-select");
  selectAssign.addEventListener("change", (e) => {
    const val = e.target.value ? parseInt(e.target.value, 10) : null;
    handleAssignTask(task.id, val);
  });

  const btnComments = card.querySelector(".card-comments-toggle");
  btnComments.addEventListener("click", () => toggleCommentsDrawer(task.id));

  const commentForm = card.querySelector(".comment-form");
  commentForm.addEventListener("submit", (e) => handleAddComment(e, task.id));

  return card;
}

async function handleMoveTask(taskId, newStatus) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        updater_name: state.activeMemberName || "Team"
      })
    });
    if (!res.ok) throw new Error("Failed to update status");
    await loadBoardTasks();
  } catch (err) {
    alert("Error updating status: " + err.message);
  }
}

async function handleAssignTask(taskId, memberId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_member_id: memberId,
        updater_name: state.activeMemberName || "Team"
      })
    });
    if (!res.ok) throw new Error("Failed to update assignee");
    await loadBoardTasks();
  } catch (err) {
    alert("Error assigning task: " + err.message);
  }
}

async function toggleCommentsDrawer(taskId) {
  const drawer = document.getElementById(`comments-drawer-${taskId}`);
  if (!drawer) return;

  const isHidden = drawer.classList.contains("hidden");
  if (isHidden) {
    drawer.classList.remove("hidden");
    await loadComments(taskId);
  } else {
    drawer.classList.add("hidden");
  }
}

async function loadComments(taskId) {
  const listEl = document.getElementById(`comments-list-${taskId}`);
  if (!listEl) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}/comments`);
    if (!res.ok) throw new Error("Failed to load comments");
    const comments = await res.json();

    if (comments.length === 0) {
      listEl.innerHTML = '<div class="text-muted text-center" style="font-size: 11px;">No comments yet.</div>';
      return;
    }

    listEl.innerHTML = comments
      .map(
        (c) => `
        <div class="comment-bubble">
          <span class="comment-author">${escapeHtml(c.member_name)}:</span>
          <span>${escapeHtml(c.comment)}</span>
          <div class="comment-time">${formatDate(c.created_at)}</div>
        </div>
      `
      )
      .join("");
  } catch (err) {
    listEl.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
  }
}

async function handleAddComment(e, taskId) {
  e.preventDefault();
  const form = e.target;
  const input = form.querySelector(".comment-input");
  const comment = input.value.trim();
  if (!comment) return;

  try {
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        member_name: state.activeMemberName || "Team",
        comment: comment
      })
    });
    if (!res.ok) throw new Error("Failed to post comment");
    input.value = "";
    await loadComments(taskId);
    await loadBoardTasks();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function setupBoardFilterHandlers() {
  const clientFilter = document.getElementById("boardFilterClient");
  const assigneeFilter = document.getElementById("boardFilterAssignee");
  const btnRefresh = document.getElementById("btnRefreshBoard");

  if (clientFilter) {
    clientFilter.addEventListener("change", (e) => {
      state.boardFilterClient = e.target.value;
      renderBoardColumns();
    });
  }

  if (assigneeFilter) {
    assigneeFilter.addEventListener("change", (e) => {
      state.boardFilterAssignee = e.target.value;
      renderBoardColumns();
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener("click", loadBoard);
  }
}

// ==============================================================================
// Money: Finances & Plain SVG Chart (Stage 5)
// ==============================================================================
async function loadFinances() {
  await loadClients();
  const monthSelect = document.getElementById("moneyMonthSelect");
  const selectedMonth = monthSelect ? monthSelect.value : state.selectedFinanceMonth;

  try {
    const res = await fetch(`/api/finances?month=${selectedMonth}`);
    if (!res.ok) throw new Error("Failed to load finances");
    const data = await res.json();

    // Populate month options
    if (monthSelect) {
      const currentVal = data.selected_month;
      monthSelect.innerHTML = "";
      data.months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === currentVal) opt.selected = true;
        monthSelect.appendChild(opt);
      });
      const optAll = document.createElement("option");
      optAll.value = "all";
      optAll.textContent = "All Months (Cumulative)";
      if (currentVal === "all") optAll.selected = true;
      monthSelect.appendChild(optAll);
    }

    // Update KPI metrics
    document.getElementById("metricTotalIncome").textContent = `$${data.total_income.toFixed(2)}`;
    document.getElementById("metricTotalExpenses").textContent = `$${data.total_expenses.toFixed(2)}`;
    document.getElementById("metricNetMargin").textContent = `$${data.net_margin.toFixed(2)}`;

    document.getElementById("metricIncomeCount").textContent = `${data.income_items.length} income entries`;
    document.getElementById("metricExpenseCount").textContent = `${data.expense_items.length} tool entries`;

    const marginPct = data.total_income > 0 ? ((data.net_margin / data.total_income) * 100).toFixed(0) : 0;
    document.getElementById("metricMarginPct").textContent = `${marginPct}% net margin`;

    // Render SVG Bar Chart of Tool Expenses
    renderToolExpensesChart(data.expenses_by_tool, data.total_expenses);

    // Render Tables
    renderIncomeTable(data.income_items);
    renderExpenseTable(data.expense_items);
  } catch (err) {
    console.error("Error loading finances:", err);
  }
}

function renderToolExpensesChart(toolData, totalExpenses) {
  const container = document.getElementById("toolExpensesChartContainer");
  if (!container) return;

  if (!toolData || toolData.length === 0 || totalExpenses === 0) {
    container.innerHTML = '<div class="text-muted text-center py-4">No software tool expenses logged for this period.</div>';
    return;
  }

  // Draw pure SVG chart (no external library, clean 1px lines, calm design)
  const rowHeight = 36;
  const chartHeight = toolData.length * rowHeight + 20;
  const labelWidth = 110;
  const barMaxWidth = 340;

  let svgContent = `<svg class="svg-chart" viewBox="0 0 600 ${chartHeight}" xmlns="http://www.w3.org/2000/svg">`;

  toolData.forEach((tool, idx) => {
    const y = idx * rowHeight + 10;
    const barWidth = Math.max(4, Math.round((tool.percentage / 100) * barMaxWidth));

    svgContent += `
      <!-- Tool Name Label -->
      <text x="${labelWidth - 10}" y="${y + 14}" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="12" font-weight="500" fill="#191c1b">
        ${escapeHtml(tool.tool_name)}
      </text>

      <!-- Background Track Bar -->
      <rect x="${labelWidth}" y="${y + 4}" width="${barMaxWidth}" height="14" rx="2" fill="#f1efe9" />

      <!-- Active Expense Bar -->
      <rect x="${labelWidth}" y="${y + 4}" width="${barWidth}" height="14" rx="2" fill="#1b3a2f" />

      <!-- Amount & Percentage Label -->
      <text x="${labelWidth + barMaxWidth + 12}" y="${y + 14}" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="11" font-weight="600" fill="#5e635f">
        $${tool.total_amount.toFixed(0)} (${tool.percentage}%)
      </text>
    `;
  });

  svgContent += "</svg>";
  container.innerHTML = svgContent;
}

function renderIncomeClientSelect() {
  const select = document.getElementById("incomeClientSelect");
  if (!select) return;

  select.innerHTML = '<option value="" disabled selected>Select client...</option>';
  state.clients.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} ($${c.monthly_fee}/mo)`;
    select.appendChild(opt);
  });
}

function renderIncomeTable(items) {
  const tbody = document.getElementById("incomeTableBody");
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-4">No income entries found.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.client_name)}</strong>
          ${item.notes ? `<div class="card-desc">${escapeHtml(item.notes)}</div>` : ""}
        </td>
        <td><span class="badge badge-status">${escapeHtml(item.month)}</span></td>
        <td><strong>$${Number(item.amount).toFixed(2)}</strong></td>
        <td class="text-right">
          <button type="button" class="btn btn-secondary btn-sm btn-del-income" data-id="${item.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  tbody.querySelectorAll(".btn-del-income").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteIncome(btn.dataset.id));
  });
}

async function handleDeleteIncome(id) {
  if (!confirm("Are you sure you want to delete this income entry?")) return;
  try {
    const res = await fetch(`/api/income/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete income");
    await loadFinances();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function renderExpenseTable(items) {
  const tbody = document.getElementById("expenseTableBody");
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-4">No tool expenses found.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map(
      (item) => `
      <tr>
        <td>
          <strong>${escapeHtml(item.tool_name)}</strong>
          ${item.notes ? `<div class="card-desc">${escapeHtml(item.notes)}</div>` : ""}
        </td>
        <td><span class="badge badge-status">${escapeHtml(item.month)}</span></td>
        <td><strong>$${Number(item.amount).toFixed(2)}</strong></td>
        <td class="text-right">
          <button type="button" class="btn btn-secondary btn-sm btn-del-expense" data-id="${item.id}">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");

  tbody.querySelectorAll(".btn-del-expense").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteExpense(btn.dataset.id));
  });
}

async function handleDeleteExpense(id) {
  if (!confirm("Are you sure you want to delete this tool expense?")) return;
  try {
    const res = await fetch(`/api/expenses/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete expense");
    await loadFinances();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function setupFinancesHandlers() {
  const monthSelect = document.getElementById("moneyMonthSelect");
  if (monthSelect) {
    monthSelect.addEventListener("change", (e) => {
      state.selectedFinanceMonth = e.target.value;
      loadFinances();
    });
  }

  const incomeForm = document.getElementById("incomeForm");
  if (incomeForm) {
    incomeForm.addEventListener("submit", handleRecordIncome);
  }

  const expenseForm = document.getElementById("expenseForm");
  if (expenseForm) {
    expenseForm.addEventListener("submit", handleLogExpense);
  }

  // Quick tool chip buttons
  document.querySelectorAll(".tool-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const toolInput = document.getElementById("expenseToolName");
      if (toolInput) {
        toolInput.value = chip.dataset.tool;
        document.getElementById("expenseAmount").focus();
      }
    });
  });
}

async function handleRecordIncome(e) {
  e.preventDefault();
  const clientSelect = document.getElementById("incomeClientSelect");
  const amountInput = document.getElementById("incomeAmount");
  const monthInput = document.getElementById("incomeMonth");
  const notesInput = document.getElementById("incomeNotes");
  const errorDiv = document.getElementById("incomeFormError");

  const clientId = parseInt(clientSelect.value, 10);
  const amount = parseFloat(amountInput.value);
  const month = monthInput.value.trim();
  const notes = notesInput.value.trim();

  if (!clientId || isNaN(amount) || !month) {
    errorDiv.textContent = "Please fill in all required fields.";
    errorDiv.classList.remove("hidden");
    return;
  }

  try {
    errorDiv.classList.add("hidden");
    const res = await fetch("/api/income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        amount: amount,
        month: month,
        notes: notes,
        creator_name: state.activeMemberName || "Team"
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to record income.");
    }

    amountInput.value = "";
    notesInput.value = "";
    await loadFinances();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

async function handleLogExpense(e) {
  e.preventDefault();
  const toolInput = document.getElementById("expenseToolName");
  const amountInput = document.getElementById("expenseAmount");
  const monthInput = document.getElementById("expenseMonth");
  const notesInput = document.getElementById("expenseNotes");
  const errorDiv = document.getElementById("expenseFormError");

  const toolName = toolInput.value.trim();
  const amount = parseFloat(amountInput.value);
  const month = monthInput.value.trim();
  const notes = notesInput.value.trim();

  if (!toolName || isNaN(amount) || !month) {
    errorDiv.textContent = "Please fill in all required fields.";
    errorDiv.classList.remove("hidden");
    return;
  }

  try {
    errorDiv.classList.add("hidden");
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: toolName,
        amount: amount,
        month: month,
        notes: notes,
        creator_name: state.activeMemberName || "Team"
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to log expense.");
    }

    toolInput.value = "";
    amountInput.value = "";
    notesInput.value = "";
    await loadFinances();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

// ==============================================================================
// Activity Log Feed (Stage 4)
// ==============================================================================
async function loadActivityFeed() {
  const tbody = document.getElementById("activityTableBody");
  if (!tbody) return;

  try {
    const res = await fetch("/api/activity");
    if (!res.ok) throw new Error("Failed to load activity feed");
    const logs = await res.json();

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-4">No recent activity logged.</td></tr>';
      return;
    }

    tbody.innerHTML = logs
      .map(
        (log) => `
        <tr>
          <td><span class="text-muted">${formatDate(log.timestamp)}</span></td>
          <td><strong>${escapeHtml(log.member_name)}</strong></td>
          <td><span class="badge badge-status">${escapeHtml(log.action)}</span></td>
          <td>${escapeHtml(log.details)}</td>
        </tr>
      `
      )
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="form-error">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ==============================================================================
// ==============================================================================
// AI Inbox (Stage 2 + Screenshot Multimodal Analysis)
// ==============================================================================

function setInboxImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Please provide an image file (PNG, JPG, WEBP).");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const base64Data = (dataUrl.split(",")[1] || "").trim();
    state.inboxImage = {
      base64: base64Data,
      mimeType: file.type || "image/png",
      name: file.name || "whatsapp-screenshot.png",
      size: (file.size / 1024).toFixed(1) + " KB"
    };
    renderInboxImagePreview();
  };
  reader.readAsDataURL(file);
}

function clearInboxImage() {
  state.inboxImage = null;
  const previewCard = document.getElementById("inboxImagePreviewCard");
  const previewImg = document.getElementById("inboxImagePreview");
  const fileInput = document.getElementById("inboxImageInput");
  if (previewCard) previewCard.classList.add("hidden");
  if (previewImg) previewImg.src = "";
  if (fileInput) fileInput.value = "";
}

function renderInboxImagePreview() {
  const previewCard = document.getElementById("inboxImagePreviewCard");
  const previewImg = document.getElementById("inboxImagePreview");
  const nameEl = document.getElementById("inboxImageName");
  const metaEl = document.getElementById("inboxImageMeta");

  if (!state.inboxImage) {
    clearInboxImage();
    return;
  }
  if (previewImg) {
    previewImg.src = `data:${state.inboxImage.mimeType};base64,${state.inboxImage.base64}`;
  }
  if (nameEl) {
    nameEl.textContent = state.inboxImage.name;
  }
  if (metaEl) {
    metaEl.textContent = `${state.inboxImage.size} • Ready for Gemma analysis`;
  }
  if (previewCard) {
    previewCard.classList.remove("hidden");
  }
}

function setupInboxImageHandlers() {
  const dropzone = document.getElementById("inboxDropzone");
  const fileInput = document.getElementById("inboxImageInput");
  const btnBrowse = document.getElementById("btnBrowseImage");
  const btnRemove = document.getElementById("btnRemoveImage");

  if (btnBrowse && fileInput) {
    btnBrowse.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => {
      fileInput.click();
    });

    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        setInboxImageFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        setInboxImageFile(e.target.files[0]);
      }
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener("click", (e) => {
      e.stopPropagation();
      clearInboxImage();
    });
  }

  // Intercept paste event anywhere when in Inbox view
  window.addEventListener("paste", (e) => {
    if (state.currentView !== "inbox") return;
    const items = (e.clipboardData || window.clipboardData)?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const namedFile = new File([file], `whatsapp-chat-${timestamp}.png`, { type: file.type || "image/png" });
          setInboxImageFile(namedFile);
          break;
        }
      }
    }
  });
}

async function handleProcessInboxMessage(e) {
  e.preventDefault();
  const clientSelect = document.getElementById("inboxClientSelect");
  const messageInput = document.getElementById("inboxMessage");
  const errorDiv = document.getElementById("inboxError");
  const loadingDiv = document.getElementById("inboxLoading");
  const btnProcess = document.getElementById("btnProcessMessage");
  const tasksContainer = document.getElementById("parsedTasksContainer");
  const tasksList = document.getElementById("parsedTasksList");

  const clientId = parseInt(clientSelect.value, 10);
  const message = (messageInput.value || "").trim();
  const imageBase64 = state.inboxImage ? state.inboxImage.base64 : "";
  const imageMimeType = state.inboxImage ? state.inboxImage.mimeType : "image/png";

  if (!clientId) {
    errorDiv.textContent = "Please select a client.";
    errorDiv.classList.remove("hidden");
    return;
  }

  if (!message && !imageBase64) {
    errorDiv.textContent = "Please enter a WhatsApp message or attach/paste a chat screenshot.";
    errorDiv.classList.remove("hidden");
    return;
  }

  errorDiv.classList.add("hidden");
  tasksContainer.classList.add("hidden");
  tasksList.innerHTML = "";

  const readingText = loadingDiv.querySelector(".reading-text");
  if (readingText) {
    readingText.textContent = imageBase64
      ? "Analyzing WhatsApp chat screenshot with Gemma..."
      : "Reading message with Gemma...";
  }

  loadingDiv.classList.remove("hidden");
  btnProcess.disabled = true;

  try {
    const res = await fetch("/api/ai/parse-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getStoredAccessCode()
      },
      body: JSON.stringify({
        client_id: clientId,
        message: message,
        image_base64: imageBase64,
        image_mime_type: imageMimeType
      })
    });

    if (res.status === 401) {
      showAccessGate("Access passcode required or invalid. Please unlock workspace.");
      throw new Error("Access passcode required or invalid.");
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to process message.");
    }

    renderParsedTasks(data.tasks, data.client_id, data.client_name);
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  } finally {
    loadingDiv.classList.add("hidden");
    btnProcess.disabled = false;
  }
}

function renderParsedTasks(tasks, clientId, clientName) {
  const container = document.getElementById("parsedTasksContainer");
  const list = document.getElementById("parsedTasksList");
  const titleEl = document.getElementById("parsedSectionTitle");

  titleEl.textContent = `Extracted Tasks for ${clientName} (${tasks.length})`;
  list.innerHTML = "";

  tasks.forEach((task, idx) => {
    const card = document.createElement("div");
    card.className = "task-edit-card";
    card.id = `task-card-${idx}`;

    const memberOptions = state.members
      .map((m) => `<option value="${m.id}" ${m.id === state.activeMemberId ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
      .join("");

    const hasClarifying = Boolean(task.clarifying_question && task.clarifying_question.trim());

    card.innerHTML = `
      <div class="task-card-meta">
        <div class="meta-field">
          <label class="meta-label">Type:</label>
          <select class="form-select form-select-sm task-type-select">
            <option value="bug" ${task.request_type === "bug" ? "selected" : ""}>Bug</option>
            <option value="new_feature" ${task.request_type === "new_feature" ? "selected" : ""}>New Feature</option>
            <option value="data_update" ${task.request_type === "data_update" ? "selected" : ""}>Data Update</option>
            <option value="content_change" ${task.request_type === "content_change" ? "selected" : ""}>Content Change</option>
            <option value="question" ${task.request_type === "question" ? "selected" : ""}>Question</option>
          </select>
        </div>

        <div class="meta-field">
          <label class="meta-label">Priority:</label>
          <select class="form-select form-select-sm task-prio-select">
            <option value="low" ${task.priority === "low" ? "selected" : ""}>Low</option>
            <option value="medium" ${task.priority === "medium" ? "selected" : ""}>Medium</option>
            <option value="high" ${task.priority === "high" ? "selected" : ""}>High</option>
          </select>
        </div>

        <div class="meta-field">
          <label class="meta-label">Assignee:</label>
          <select class="form-select form-select-sm task-assign-select">
            <option value="">Unassigned</option>
            ${memberOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="meta-label">Title</label>
        <input type="text" class="form-input task-title-input" value="${escapeHtml(task.task_title)}" />
      </div>

      <div class="form-group">
        <label class="meta-label">Description</label>
        <textarea class="form-textarea task-desc-input" rows="2">${escapeHtml(task.task_description)}</textarea>
      </div>

      ${
        hasClarifying
          ? `
          <div class="clarifying-box">
            <span class="clarifying-header">Clarifying question for client</span>
            <input type="text" class="clarifying-input" value="${escapeHtml(task.clarifying_question)}" />
          </div>
          `
          : `
          <div class="clarifying-box hidden">
            <span class="clarifying-header">Clarifying question for client</span>
            <input type="text" class="clarifying-input" value="" />
          </div>
          `
      }

      <div class="task-card-footer">
        <button type="button" class="btn btn-primary btn-sm btn-create-task" data-index="${idx}">
          Create task
        </button>
        <div class="task-save-status hidden" id="save-status-${idx}">
          Saved to board
        </div>
      </div>
    `;

    const btnCreate = card.querySelector(".btn-create-task");
    btnCreate.addEventListener("click", () => saveTaskFromRow(card, clientId, idx));

    list.appendChild(card);
  });

  container.classList.remove("hidden");
}

async function saveTaskFromRow(cardElement, clientId, idx) {
  const btnCreate = cardElement.querySelector(".btn-create-task");
  const saveStatus = cardElement.querySelector(`#save-status-${idx}`);

  const typeSelect = cardElement.querySelector(".task-type-select");
  const prioSelect = cardElement.querySelector(".task-prio-select");
  const assignSelect = cardElement.querySelector(".task-assign-select");
  const titleInput = cardElement.querySelector(".task-title-input");
  const descInput = cardElement.querySelector(".task-desc-input");
  const clarifyingInput = cardElement.querySelector(".clarifying-input");

  const title = titleInput.value.trim();
  if (!title) {
    alert("Please enter a task title.");
    titleInput.focus();
    return;
  }

  const payload = {
    client_id: clientId,
    title: title,
    description: descInput.value.trim(),
    request_type: typeSelect.value,
    priority: prioSelect.value,
    status: "todo",
    assigned_member_id: assignSelect.value ? parseInt(assignSelect.value, 10) : null,
    clarifying_question: clarifyingInput ? clarifyingInput.value.trim() : "",
    creator_name: state.activeMemberName || "Team"
  };

  btnCreate.disabled = true;
  btnCreate.textContent = "Saving...";

  try {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to create task.");
    }

    btnCreate.textContent = "Saved";
    btnCreate.classList.remove("btn-primary");
    btnCreate.classList.add("btn-secondary");
    if (saveStatus) {
      saveStatus.classList.remove("hidden");
    }
  } catch (err) {
    alert("Error creating task: " + err.message);
    btnCreate.disabled = false;
    btnCreate.textContent = "Create task";
  }
}

function setupSamplePrompts() {
  const sampleBtn1 = document.getElementById("sampleBtn1");
  const sampleBtn2 = document.getElementById("sampleBtn2");
  const messageInput = document.getElementById("inboxMessage");
  const clientSelect = document.getElementById("inboxClientSelect");

  if (sampleBtn1 && messageInput) {
    sampleBtn1.addEventListener("click", () => {
      messageInput.value =
        "Bhai booking page pe date selector crash ho raha hai iPhone pe, please fix this urgent! Aur Diwali menu banner update kar dena jab time mile. Ek aur sawal - online advance payment possible hai kya?";
      if (clientSelect && clientSelect.options.length > 1) {
        clientSelect.selectedIndex = 1;
      }
      messageInput.focus();
    });
  }

  if (sampleBtn2 && messageInput) {
    sampleBtn2.addEventListener("click", () => {
      messageInput.value =
        "Hey, can you please change the website look and color theme? Make it feel more premium.";
      if (clientSelect && clientSelect.options.length > 2) {
        clientSelect.selectedIndex = 2;
      }
      messageInput.focus();
    });
  }

  const btnClear = document.getElementById("btnClearMessage");
  if (btnClear && messageInput) {
    btnClear.addEventListener("click", () => {
      messageInput.value = "";
      clearInboxImage();
      document.getElementById("inboxError").classList.add("hidden");
      document.getElementById("parsedTasksContainer").classList.add("hidden");
      messageInput.focus();
    });
  }
}

// ==============================================================================
// Authentication & Shared Access Gate (Stage 7)
// ==============================================================================

function getStoredAccessCode() {
  return (localStorage.getItem("newvora_access_code") || "").trim();
}

function setStoredAccessCode(code) {
  if (code && code.trim()) {
    localStorage.setItem("newvora_access_code", code.trim());
  } else {
    localStorage.removeItem("newvora_access_code");
  }
}

function showAccessGate(errorMessage = "") {
  const gate = document.getElementById("accessGateOverlay");
  const app = document.getElementById("appLayout");
  const errEl = document.getElementById("accessGateError");
  const input = document.getElementById("accessCodeInput");

  if (app) app.classList.add("hidden");
  if (gate) gate.classList.remove("hidden");
  if (errEl) {
    if (errorMessage) {
      errEl.textContent = errorMessage;
      errEl.classList.remove("hidden");
    } else {
      errEl.classList.add("hidden");
    }
  }
  if (input) {
    input.value = "";
    setTimeout(() => input.focus(), 50);
  }
}

function hideAccessGate() {
  const gate = document.getElementById("accessGateOverlay");
  const app = document.getElementById("appLayout");
  if (gate) gate.classList.add("hidden");
  if (app) app.classList.remove("hidden");
}

async function handleAccessGateSubmit(e) {
  e.preventDefault();
  const input = document.getElementById("accessCodeInput");
  const errEl = document.getElementById("accessGateError");
  const btn = document.getElementById("btnUnlockApp");
  const code = (input.value || "").trim();

  if (!code) {
    errEl.textContent = "Please enter the access passcode.";
    errEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Verifying...";
  errEl.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: code })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Invalid access passcode.");
    }

    setStoredAccessCode(code);
    hideAccessGate();
    initApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    input.select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock Workspace";
  }
}

async function checkAccessAndInit() {
  const savedCode = getStoredAccessCode();
  if (!savedCode) {
    showAccessGate();
    return;
  }

  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_code: savedCode })
    });

    if (res.ok) {
      hideAccessGate();
      initApp();
    } else {
      setStoredAccessCode("");
      showAccessGate("Access session expired. Please enter the team passcode.");
    }
  } catch (err) {
    showAccessGate("Could not connect to server. Please try again.");
  }
}

function initApp() {
  if (state.appInitialized) return;
  state.appInitialized = true;

  // 1. Navigation event delegation
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const view = link.dataset.view;
      navigateTo(view);
    });
  });

  // Handle URL hash on initial load
  const initialHash = window.location.hash.replace("#", "");
  if (initialHash && VIEW_METADATA[initialHash]) {
    navigateTo(initialHash);
  } else {
    navigateTo("inbox");
  }

  // 2. Member picker events
  const memberSelect = document.getElementById("memberSelect");
  memberSelect.addEventListener("change", handleMemberChange);

  const btnAddMemberToggle = document.getElementById("btnAddMemberToggle");
  const addMemberForm = document.getElementById("addMemberForm");
  const btnCancelMember = document.getElementById("btnCancelMember");
  const btnSaveMember = document.getElementById("btnSaveMember");

  btnAddMemberToggle.addEventListener("click", () => {
    addMemberForm.classList.toggle("hidden");
    if (!addMemberForm.classList.contains("hidden")) {
      document.getElementById("newMemberName").focus();
    }
  });

  btnCancelMember.addEventListener("click", () => {
    addMemberForm.classList.add("hidden");
    document.getElementById("memberErrorMsg").classList.add("hidden");
  });

  btnSaveMember.addEventListener("click", handleSaveNewMember);

  // 3. Mobile menu toggle
  const mobileToggle = document.getElementById("mobileMenuToggle");
  const sidebar = document.getElementById("sidebar");
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener("click", () => {
      sidebar.classList.toggle("mobile-open");
    });
  }

  // 4. AI Inbox form, screenshot handler & samples
  const inboxForm = document.getElementById("inboxForm");
  if (inboxForm) {
    inboxForm.addEventListener("submit", handleProcessInboxMessage);
  }
  setupSamplePrompts();
  setupInboxImageHandlers();

  // 5. Stage 3 & 4 handlers
  setupClientFormHandlers();
  setupBoardFilterHandlers();

  // 6. Stage 5 Finances handlers
  setupFinancesHandlers();

  const btnRefreshActivity = document.getElementById("btnRefreshActivity");
  if (btnRefreshActivity) {
    btnRefreshActivity.addEventListener("click", loadActivityFeed);
  }

  // 7. Initial data load
  loadMembers();
  loadClients();
}

// ==============================================================================
// Initial Setup & Event Listeners
// ==============================================================================
document.addEventListener("DOMContentLoaded", () => {
  const accessGateForm = document.getElementById("accessGateForm");
  if (accessGateForm) {
    accessGateForm.addEventListener("submit", handleAccessGateSubmit);
  }
  checkAccessAndInit();
});
