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
  dues: {
    title: "Dues",
    description: "Track monthly client retainers, overdue payments, and establishment balances."
  },
  tools: {
    title: "Tools",
    description: "Software subscriptions, monthly costs, renewal dates, and expense logging."
  },
  money: {
    title: "Money",
    description: "Track monthly income, software expenses, and net margin."
  },
  notifications: {
    title: "Notification Center",
    description: "Team assignments, comments, tool renewals, and billing reminders."
  },
  report: {
    title: "Monthly Report",
    description: "Executive monthly overview, tasks breakdown, payments, and AI summary."
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
  selectedDuesMonth: "2026-10",
  duesData: null,
  toolsData: [],
  notifications: [],
  unreadNotificationsCount: 0,
  notificationsCenterData: [],
  unreadCenterCount: 0,
  notificationsFilter: "all",
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
  } else if (viewName === "dues") {
    loadDuesView();
  } else if (viewName === "tools") {
    loadToolsView();
  } else if (viewName === "money") {
    loadFinances();
  } else if (viewName === "activity") {
    loadActivityFeed();
  } else if (viewName === "notifications") {
    loadNotificationsCenter();
  } else if (viewName === "report") {
    if (typeof loadReportView === "function") loadReportView();
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
  if (state.activeMemberId) {
    loadNotifications(state.activeMemberId);
    loadNotificationsCenter();
  }
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
    loadNotifications(found.id);
    loadNotificationsCenter();
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
    loadNotifications(created.id);
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

// ==============================================================================
// Stage 7: Task Notifications ("Assigned to you")
// ==============================================================================
async function loadNotifications(memberId) {
  if (!memberId) return;
  try {
    const res = await fetch(`/api/notifications?member_id=${memberId}`);
    if (!res.ok) return;
    const data = await res.json();
    state.notifications = data.notifications || [];
    state.unreadNotificationsCount = data.unread_count || 0;
    updateNotificationBadges();
    renderAssignedTasksModal();
  } catch (err) {
    console.error("Error loading notifications:", err);
  }
}

function updateNotificationBadges() {
  const count = state.unreadNotificationsCount;
  const badgeSidebar = document.getElementById("memberUnreadBadge");
  const badgeHeader = document.getElementById("memberHeaderBadge");
  const assignedCountEl = document.getElementById("assignedCount");

  if (assignedCountEl) {
    assignedCountEl.textContent = count;
  }

  [badgeSidebar, badgeHeader].forEach((badge) => {
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  });
}

function renderAssignedTasksModal() {
  const listEl = document.getElementById("assignedTasksList");
  const subtitleEl = document.getElementById("assignedTasksMemberSubtitle");
  if (!listEl) return;

  if (subtitleEl) {
    subtitleEl.textContent = `Tasks assigned to ${state.activeMemberName} (${state.notifications.length} total, ${state.unreadNotificationsCount} unread)`;
  }

  if (state.notifications.length === 0) {
    listEl.innerHTML = '<div class="text-muted text-center py-4">No tasks currently assigned to you.</div>';
    return;
  }

  listEl.innerHTML = "";
  state.notifications.forEach((item) => {
    const card = document.createElement("div");
    card.className = `assigned-task-item ${!item.is_read ? "is-unread" : ""}`;

    let prioClass = "badge-prio-low";
    if (item.priority === "high") prioClass = "badge-prio-high";
    if (item.priority === "medium") prioClass = "badge-prio-medium";

    let statusClass = "badge-status";
    if (item.status === "doing") statusClass = "badge-status-doing";
    if (item.status === "done") statusClass = "badge-status-done";

    card.innerHTML = `
      <div class="assigned-task-top">
        <div>
          <div class="assigned-task-title">${escapeHtml(item.title)}</div>
          <div class="assigned-task-meta mt-1">
            <span><strong>Client:</strong> ${escapeHtml(item.client_name)}</span>
            <span class="badge ${prioClass}">${escapeHtml(item.priority.toUpperCase())}</span>
            <span class="badge ${statusClass}">${escapeHtml(item.status.toUpperCase())}</span>
            <span class="text-muted">${formatDate(item.created_at)}</span>
          </div>
        </div>
        ${!item.is_read ? `
          <button type="button" class="btn btn-secondary btn-sm btn-mark-read" data-id="${item.notification_id}">
            Mark as read
          </button>
        ` : `
          <span class="badge badge-status" style="font-size: 10px; color: var(--text-muted);">Read</span>
        `}
      </div>
      ${item.description ? `<div class="card-desc text-muted mt-1" style="font-size: 12px;">${escapeHtml(item.description)}</div>` : ""}
    `;

    const btnMarkRead = card.querySelector(".btn-mark-read");
    if (btnMarkRead) {
      btnMarkRead.addEventListener("click", () => handleMarkNotificationRead(item.notification_id));
    }

    listEl.appendChild(card);
  });
}

async function handleMarkNotificationRead(notificationId) {
  try {
    const res = await fetch(`/api/notifications/${notificationId}/read`, {
      method: "PATCH"
    });
    if (!res.ok) throw new Error("Failed to mark notification as read");
    await loadNotifications(state.activeMemberId);
  } catch (err) {
    console.error("Error marking notification read:", err);
  }
}

// ==============================================================================
// Stage 8 Part 4: Centralized Notification Center
// ==============================================================================
async function loadNotificationsCenter() {
  const memberId = state.activeMemberId;
  const accessCode = getStoredAccessCode();

  try {
    const url = memberId ? `/api/notifications-center?member_id=${memberId}` : `/api/notifications-center`;
    const res = await fetch(url, {
      headers: {
        "X-Access-Code": accessCode
      }
    });
    if (!res.ok) return;
    const data = await res.json();
    state.notificationsCenterData = data.notifications || [];
    state.unreadCenterCount = data.unread_count || 0;

    // Update bell badge
    const bellBadge = document.getElementById("bellUnreadBadge");
    if (bellBadge) {
      if (data.unread_count > 0) {
        bellBadge.textContent = data.unread_count;
        bellBadge.classList.remove("hidden");
      } else {
        bellBadge.classList.add("hidden");
      }
    }

    if (state.currentView === "notifications") {
      renderNotificationsCenter();
    }
  } catch (err) {
    console.error("Error loading notification center:", err);
  }
}

function renderNotificationsCenter() {
  const listEl = document.getElementById("notificationsList");
  const emptyEl = document.getElementById("notificationsEmptyState");
  const subheader = document.getElementById("notificationsSubheader");
  if (!listEl) return;

  if (subheader) {
    subheader.textContent = `Updates, task alerts, tool renewals, and payment reminders for ${state.activeMemberName}`;
  }

  let items = state.notificationsCenterData || [];
  if (state.notificationsFilter === "unread") {
    items = items.filter((n) => !n.is_read);
  }

  if (items.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.classList.remove("hidden");
    return;
  }

  if (emptyEl) emptyEl.classList.add("hidden");
  listEl.innerHTML = "";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = `notification-card ${!item.is_read ? "is-unread" : ""}`;

    let typeBadge = "badge-status";
    let typeLabel = item.type;
    if (item.type === "assignment") {
      typeBadge = "badge-type";
      typeLabel = "Assignment";
    } else if (item.type === "comment") {
      typeBadge = "badge-status";
      typeLabel = "Comment";
    } else if (item.type === "status_change") {
      typeBadge = "badge-status";
      typeLabel = "Status Change";
    } else if (item.type === "tool_renewal") {
      typeBadge = "badge-warning";
      typeLabel = "Tool Renewal";
    } else if (item.type === "tool_budget") {
      typeBadge = "badge-danger";
      typeLabel = "Tool Budget";
    } else if (item.type === "client_payment") {
      typeBadge = "badge-overdue";
      typeLabel = "Client Overdue";
    } else if (item.type === "month_end") {
      typeBadge = "badge-overdue";
      typeLabel = "Month End";
    }

    card.innerHTML = `
      <div class="notification-body">
        <div class="notification-text">${escapeHtml(item.text)}</div>
        <div class="notification-meta">
          <span class="badge ${typeBadge}">${escapeHtml(typeLabel)}</span>
          <span>${formatDate(item.created_at)}</span>
          ${item.link_type ? `<span class="text-primary" style="font-weight: 700; cursor: pointer;">View ${escapeHtml(item.link_type)} &rarr;</span>` : ""}
        </div>
      </div>
      <div class="notification-actions" style="display: flex; align-items: center; gap: 8px;">
        ${!item.is_read ? `
          <button type="button" class="btn btn-secondary btn-sm btn-mark-center-read" data-id="${item.id}">
            Mark as read
          </button>
        ` : `
          <span class="badge badge-status" style="font-size: 10px; color: var(--text-muted);">Read</span>
        `}
      </div>
    `;

    // Mark as read button
    const btnMark = card.querySelector(".btn-mark-center-read");
    if (btnMark) {
      btnMark.addEventListener("click", async (e) => {
        e.stopPropagation();
        await handleMarkCenterNotificationRead(item.id);
      });
    }

    // Clicking notification opens the related task, client, or tool page
    card.addEventListener("click", async () => {
      if (!item.is_read) {
        await handleMarkCenterNotificationRead(item.id, false);
      }
      if (item.link_type === "task") {
        navigateTo("board");
        setTimeout(() => {
          const taskEl = document.getElementById(`task-card-${item.link_id}`);
          if (taskEl) {
            taskEl.scrollIntoView({ behavior: "smooth", block: "center" });
            taskEl.style.boxShadow = "0 0 0 3px rgba(46, 139, 122, 0.4)";
            setTimeout(() => { taskEl.style.boxShadow = ""; }, 2500);
            if (item.type === "comment") {
              toggleCommentsDrawer(item.link_id);
            }
          }
        }, 300);
      } else if (item.link_type === "tool") {
        navigateTo("tools");
      } else if (item.link_type === "dues" || item.link_type === "client") {
        navigateTo("dues");
      }
    });

    listEl.appendChild(card);
  });
}

async function handleMarkCenterNotificationRead(notifId, refreshView = true) {
  try {
    const res = await fetch(`/api/notifications-center/${notifId}/read`, {
      method: "PATCH",
      headers: {
        "X-Access-Code": getStoredAccessCode()
      }
    });
    if (!res.ok) throw new Error("Failed to mark read");
    if (refreshView) {
      await loadNotificationsCenter();
    }
  } catch (err) {
    console.error("Error marking notification read:", err);
  }
}

async function handleMarkAllCenterNotificationsRead() {
  const memberId = state.activeMemberId;
  const url = memberId ? `/api/notifications-center/mark-all-read?member_id=${memberId}` : `/api/notifications-center/mark-all-read`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Access-Code": getStoredAccessCode()
      }
    });
    if (!res.ok) throw new Error("Failed to mark all read");
    await loadNotificationsCenter();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

function setupNotificationsCenterHandlers() {
  const bellBtn = document.getElementById("btnNotificationsBell");
  if (bellBtn) {
    bellBtn.addEventListener("click", () => {
      navigateTo("notifications");
    });
  }

  const btnAll = document.getElementById("btnFilterNotifsAll");
  const btnUnread = document.getElementById("btnFilterNotifsUnread");
  const btnMarkAll = document.getElementById("btnMarkAllNotifsRead");

  if (btnAll) {
    btnAll.addEventListener("click", () => {
      state.notificationsFilter = "all";
      btnAll.classList.remove("btn-secondary");
      btnAll.classList.add("btn-primary");
      btnUnread?.classList.remove("btn-primary");
      btnUnread?.classList.add("btn-secondary");
      renderNotificationsCenter();
    });
  }

  if (btnUnread) {
    btnUnread.addEventListener("click", () => {
      state.notificationsFilter = "unread";
      btnUnread.classList.remove("btn-secondary");
      btnUnread.classList.add("btn-primary");
      btnAll?.classList.remove("btn-primary");
      btnAll?.classList.add("btn-secondary");
      renderNotificationsCenter();
    });
  }

  if (btnMarkAll) {
    btnMarkAll.addEventListener("click", handleMarkAllCenterNotificationsRead);
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

    const bDay = c.billing_day || 1;
    const estTotal = Number(c.establishment_fee_total || 0);
    const estPaid = Number(c.establishment_fee_paid || 0);
    const estRemaining = Math.max(0, estTotal - estPaid);

    const bDayEl = document.getElementById("detailClientBillingDay");
    if (bDayEl) bDayEl.textContent = `Day ${bDay} of month`;

    const estEl = document.getElementById("detailClientEstablishment");
    if (estEl) {
      estEl.textContent = estTotal > 0 ? `$${estPaid.toFixed(0)} / $${estTotal.toFixed(0)} ($${estRemaining.toFixed(0)} remaining)` : "None ($0)";
    }

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
      document.getElementById("clientFormBillingDay").value = "1";
      document.getElementById("clientFormEstablishmentTotal").value = "0";
      document.getElementById("clientFormEstablishmentPaid").value = "0";
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
  document.getElementById("clientFormBillingDay").value = client.billing_day || 1;
  document.getElementById("clientFormEstablishmentTotal").value = client.establishment_fee_total || 0;
  document.getElementById("clientFormEstablishmentPaid").value = client.establishment_fee_paid || 0;
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
  const billing_day = parseInt(document.getElementById("clientFormBillingDay").value, 10) || 1;
  const establishment_fee_total = parseFloat(document.getElementById("clientFormEstablishmentTotal").value) || 0;
  const establishment_fee_paid = parseFloat(document.getElementById("clientFormEstablishmentPaid").value) || 0;
  const notes = document.getElementById("clientFormNotes").value.trim();
  const errorDiv = document.getElementById("clientFormError");

  const payload = {
    name,
    company,
    plan_name,
    monthly_fee,
    contract_end_date,
    billing_day,
    establishment_fee_total,
    establishment_fee_paid,
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
    if (state.activeMemberId) {
      await loadNotifications(state.activeMemberId);
    }
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

  setupManualTaskHandlers();
}

function setupManualTaskHandlers() {
  const btnOpen = document.getElementById("btnOpenNewTask");
  const card = document.getElementById("newTaskCard");
  const btnCancel = document.getElementById("btnCancelNewTask");
  const form = document.getElementById("newTaskForm");
  const clientSelect = document.getElementById("newTaskClientSelect");
  const assigneeSelect = document.getElementById("newTaskAssigneeSelect");
  const errorDiv = document.getElementById("newTaskError");

  function populateNewTaskDropdowns() {
    if (clientSelect) {
      const curClient = clientSelect.value;
      clientSelect.innerHTML = '<option value="" disabled selected>Select client...</option>';
      state.clients.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.company})`;
        if (curClient && String(c.id) === String(curClient)) opt.selected = true;
        clientSelect.appendChild(opt);
      });
      if (!clientSelect.value && state.clients.length > 0) {
        clientSelect.value = state.clients[0].id;
      }
    }

    if (assigneeSelect) {
      assigneeSelect.innerHTML = '<option value="">Unassigned</option>';
      state.members.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === state.activeMemberId) opt.selected = true;
        assigneeSelect.appendChild(opt);
      });
    }
  }

  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      populateNewTaskDropdowns();
      if (card) {
        card.classList.remove("hidden");
        document.getElementById("newTaskTitleInput")?.focus();
      }
      if (errorDiv) errorDiv.classList.add("hidden");
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      if (card) card.classList.add("hidden");
      if (errorDiv) errorDiv.classList.add("hidden");
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clientId = parseInt(document.getElementById("newTaskClientSelect").value, 10);
      const title = document.getElementById("newTaskTitleInput").value.trim();
      const description = document.getElementById("newTaskDescriptionInput").value.trim();
      const reqType = document.getElementById("newTaskTypeSelect").value;
      const priority = document.getElementById("newTaskPrioritySelect").value;
      const assigneeVal = document.getElementById("newTaskAssigneeSelect").value;
      const assignedMemberId = assigneeVal ? parseInt(assigneeVal, 10) : null;

      if (!clientId) {
        if (errorDiv) {
          errorDiv.textContent = "Please select a client.";
          errorDiv.classList.remove("hidden");
        }
        return;
      }

      if (!title) {
        if (errorDiv) {
          errorDiv.textContent = "Please enter a task title.";
          errorDiv.classList.remove("hidden");
        }
        return;
      }

      const saveBtn = document.getElementById("btnSaveNewTask");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
      }

      try {
        if (errorDiv) errorDiv.classList.add("hidden");
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            client_id: clientId,
            title: title,
            description: description,
            request_type: reqType,
            priority: priority,
            status: "todo",
            assigned_member_id: assignedMemberId,
            creator_name: state.activeMemberName || "Team"
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to create task.");
        }

        form.reset();
        if (card) card.classList.add("hidden");
        await loadBoardTasks();
        if (state.activeMemberId) {
          await loadNotifications(state.activeMemberId);
        }
      } catch (err) {
        if (errorDiv) {
          errorDiv.textContent = err.message;
          errorDiv.classList.remove("hidden");
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save task";
        }
      }
    });
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

    // Render Month-end Reminder Banner (Part 2)
    const moneyBanner = document.getElementById("moneyMonthEndBanner");
    if (moneyBanner) {
      if (data.month_end_reminder && data.month_end_reminder.show_banner) {
        moneyBanner.innerHTML = `<span class="month-end-banner-icon">&#9888;</span><span>${escapeHtml(data.month_end_reminder.banner_message)}</span>`;
        moneyBanner.classList.remove("hidden");
      } else {
        moneyBanner.classList.add("hidden");
      }
    }

    // Render Money page summary strip (Stage 7)
    renderMoneySummaryStrip(data.summary_strip);

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
      <text class="chart-label-tool" x="${labelWidth - 10}" y="${y + 14}" text-anchor="end" font-family="inherit" font-size="12" font-weight="600" fill="var(--text-main, #1F2A2E)">
        ${escapeHtml(tool.tool_name)}
      </text>

      <!-- Background Track Bar -->
      <rect class="chart-track-bar" x="${labelWidth}" y="${y + 4}" width="${barMaxWidth}" height="14" rx="2" fill="var(--bar-bg, #E2EAE4)" />

      <!-- Active Expense Bar -->
      <rect class="chart-fill-bar" x="${labelWidth}" y="${y + 4}" width="${barWidth}" height="14" rx="2" fill="var(--bar-fill, #1F8A70)" />

      <!-- Amount & Percentage Label -->
      <text class="chart-label-val" x="${labelWidth + barMaxWidth + 12}" y="${y + 14}" font-family="inherit" font-size="11" font-weight="600" fill="var(--text-muted, #5F7076)">
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
// Stage 7: Money Summary Strip
// ==============================================================================
function renderMoneySummaryStrip(strip) {
  const stripEl = document.getElementById("moneySummaryStrip");
  if (!stripEl) return;

  if (!strip) {
    stripEl.classList.add("hidden");
    return;
  }

  stripEl.classList.remove("hidden");
  const renewingTools = strip.renewing_tools || [];
  const toolsListStr = renewingTools
    .map((t) => `${escapeHtml(t.name)} (in ${t.days_left}d, $${t.monthly_cost.toFixed(0)})`)
    .join(", ");

  const duesText = strip.pending_dues_count > 0
    ? `<span><strong>$${strip.pending_dues_total.toFixed(0)} pending</strong> in client dues across ${strip.pending_dues_count} client${strip.pending_dues_count === 1 ? "" : "s"}</span> &mdash; <a class="summary-strip-link" href="#dues" id="linkToDues">View dues &rarr;</a>`
    : `<span>All client retainers settled for ${escapeHtml(strip.month)}.</span>`;

  const toolsText = strip.renewing_tools_count > 0
    ? `<span><strong>${strip.renewing_tools_count} tool${strip.renewing_tools_count === 1 ? "" : "s"}</strong> renewing within 7 days: ${toolsListStr}</span> &mdash; <a class="summary-strip-link" href="#tools" id="linkToTools">View tools &rarr;</a>`
    : `<span>No software tools renewing in next 7 days.</span>`;

  stripEl.innerHTML = `
    <div class="summary-strip-header">Upcoming Obligations &amp; Dues (${escapeHtml(strip.month)})</div>
    <div class="summary-strip-content">
      <div class="summary-strip-item">${duesText}</div>
      <div class="summary-strip-item">${toolsText}</div>
    </div>
  `;

  const linkDues = stripEl.querySelector("#linkToDues");
  if (linkDues) {
    linkDues.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("dues");
    });
  }

  const linkTools = stripEl.querySelector("#linkToTools");
  if (linkTools) {
    linkTools.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("tools");
    });
  }
}

// ==============================================================================
// Stage 7: Dues Management
// ==============================================================================
async function loadDuesView() {
  const monthSelect = document.getElementById("duesMonthSelect");
  const selectedMonth = monthSelect ? monthSelect.value : state.selectedDuesMonth;

  try {
    const res = await fetch(`/api/dues?month=${selectedMonth}`);
    if (!res.ok) throw new Error("Failed to load client dues");
    const data = await res.json();
    state.duesData = data;

    // Populate month options dynamically
    if (monthSelect && data.available_months && data.available_months.length > 0) {
      const cur = data.month || selectedMonth;
      monthSelect.innerHTML = "";
      data.available_months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === cur) opt.selected = true;
        monthSelect.appendChild(opt);
      });
    }

    // Render Month-end Reminder Banner (Part 2)
    const duesBanner = document.getElementById("duesMonthEndBanner");
    if (duesBanner) {
      if (data.reminder && data.reminder.show_banner) {
        duesBanner.innerHTML = `<span class="month-end-banner-icon">&#9888;</span><span>${escapeHtml(data.reminder.banner_message)}</span>`;
        duesBanner.classList.remove("hidden");
      } else {
        duesBanner.classList.add("hidden");
      }
    }

    // Update KPI metrics
    const totalPendingEl = document.getElementById("duesTotalPending");
    if (totalPendingEl) {
      totalPendingEl.textContent = `$${data.total_pending.toFixed(2)}`;
    }

    let pendingCount = 0;
    let estOutstandingTotal = 0;
    let estCount = 0;

    (data.clients || []).forEach((c) => {
      if (c.status === "pending" || c.status === "overdue" || c.status === "partial") {
        pendingCount++;
      }
      if (c.establishment_fee_remaining > 0) {
        estOutstandingTotal += c.establishment_fee_remaining;
        estCount++;
      }
    });

    const pendingCountEl = document.getElementById("duesPendingCount");
    if (pendingCountEl) {
      pendingCountEl.textContent = `${pendingCount} client${pendingCount === 1 ? "" : "s"} pending, partial, or overdue`;
    }

    const estOutstandingEl = document.getElementById("duesTotalEstOutstanding");
    if (estOutstandingEl) {
      estOutstandingEl.textContent = `$${estOutstandingTotal.toFixed(2)}`;
    }

    const estCountEl = document.getElementById("duesEstCount");
    if (estCountEl) {
      estCountEl.textContent = `${estCount} client${estCount === 1 ? "" : "s"} with remaining balance`;
    }

    renderDuesTable(data.clients || [], data.month || selectedMonth);
  } catch (err) {
    console.error("Error loading dues:", err);
  }
}

function renderDuesTable(clients, selectedMonth) {
  const tbody = document.getElementById("duesTableBody");
  if (!tbody) return;

  if (!clients || clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">No clients found.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  clients.forEach((c) => {
    const tr = document.createElement("tr");

    let statusBadgeClass = "badge-pending";
    let statusLabel = "PENDING";
    if (c.status === "paid") {
      statusBadgeClass = "badge-paid";
      statusLabel = "PAID";
    } else if (c.status === "partial") {
      statusBadgeClass = "badge-partial";
      statusLabel = "PARTIAL";
    } else if (c.status === "overdue") {
      statusBadgeClass = "badge-overdue";
      statusLabel = "OVERDUE";
    }

    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(c.name)}</strong>
        <div class="card-meta mt-1 text-muted">${escapeHtml(c.company)}</div>
      </td>
      <td><strong>$${c.amount_expected.toFixed(0)}</strong></td>
      <td><strong>$${c.amount_received.toFixed(0)}</strong></td>
      <td><strong class="${c.balance > 0 ? "metric-expense" : ""}">${c.balance > 0 ? "$" + c.balance.toFixed(0) : "$0"}</strong></td>
      <td>
        <div>Day ${c.billing_day}</div>
        <div class="text-muted" style="font-size: 11px;">Due: ${c.due_date}</div>
      </td>
      <td><span class="badge ${statusBadgeClass}">${statusLabel}</span></td>
      <td class="text-right">
        <button type="button" class="btn btn-primary btn-sm btn-open-payment" data-id="${c.client_id}">
          Record payment
        </button>
        <button type="button" class="btn btn-secondary btn-sm btn-view-history ml-1" data-id="${c.client_id}">
          History (${(c.history || []).length})
        </button>
      </td>
    `;

    const btnPay = tr.querySelector(".btn-open-payment");
    if (btnPay) {
      btnPay.addEventListener("click", () => openRecordPaymentForm(c, selectedMonth));
    }

    const btnHistory = tr.querySelector(".btn-view-history");
    if (btnHistory) {
      btnHistory.addEventListener("click", () => openPaymentHistoryModal(c));
    }

    tbody.appendChild(tr);
  });
}

function openRecordPaymentForm(client, selectedMonth) {
  const card = document.getElementById("duesPaymentCard");
  const form = document.getElementById("duesPaymentForm");
  const errEl = document.getElementById("duesPaymentError");
  if (!card) return;

  document.getElementById("paymentClientId").value = client.client_id;
  document.getElementById("paymentClientName").value = client.name;
  document.getElementById("paymentMonth").value = selectedMonth;
  document.getElementById("paymentAmountExpected").value = client.amount_expected;
  document.getElementById("paymentAmountReceived").value = client.amount_received || client.amount_expected;
  document.getElementById("paymentDateReceived").value = client.date_received || new Date().toISOString().slice(0, 10);
  document.getElementById("paymentMethod").value = client.method || "UPI";
  document.getElementById("paymentNote").value = client.note || "";

  if (errEl) errEl.classList.add("hidden");
  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("paymentAmountReceived")?.focus();
}

function openPaymentHistoryModal(client) {
  const modal = document.getElementById("paymentHistoryModal");
  const title = document.getElementById("historyClientTitle");
  const tbody = document.getElementById("paymentHistoryTableBody");
  if (!modal || !tbody) return;

  if (title) title.textContent = `Payment History: ${client.name}`;

  const history = client.history || [];
  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">No past payment entries found.</td></tr>';
  } else {
    tbody.innerHTML = history.map((p) => {
      const exp = Number(p.amount_expected || 0);
      const rec = Number(p.amount_received || 0);
      const bal = Math.max(0, exp - rec);
      return `
        <tr>
          <td><span class="badge badge-status">${escapeHtml(p.month)}</span></td>
          <td><strong>$${exp.toFixed(0)}</strong></td>
          <td><strong>$${rec.toFixed(0)}</strong></td>
          <td><strong class="${bal > 0 ? "metric-expense" : ""}">${bal > 0 ? "$" + bal.toFixed(0) : "$0"}</strong></td>
          <td>${escapeHtml(p.date_received || "-")}</td>
          <td><span class="badge badge-type">${escapeHtml(p.method || "-")}</span></td>
          <td><span class="text-muted">${escapeHtml(p.note || "-")}</span></td>
        </tr>
      `;
    }).join("");
  }

  modal.classList.remove("hidden");
}

async function handleMarkDuePaid(clientId, feeType, month) {
  try {
    const res = await fetch("/api/dues/mark-paid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getStoredAccessCode()
      },
      body: JSON.stringify({
        client_id: clientId,
        fee_type: feeType,
        month: month,
        creator_name: state.activeMemberName
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to mark payment.");
    }

    await loadDuesView();
    if (state.currentView === "money") {
      await loadFinances();
    }
    await loadActivityFeed();
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// ==============================================================================
// Stage 7: Tools Management
// ==============================================================================
async function loadToolsView() {
  try {
    const res = await fetch("/api/tools");
    if (!res.ok) throw new Error("Failed to load software tools");
    const tools = await res.json();
    state.toolsData = tools;
    renderToolsTable(tools);
  } catch (err) {
    console.error("Error loading tools:", err);
  }
}

function renderToolsTable(tools) {
  const tbody = document.getElementById("toolsTableBody");
  if (!tbody) return;

  if (!tools || tools.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-muted text-center py-4">No software tools recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = "";
  tools.forEach((t) => {
    const tr = document.createElement("tr");

    const clampedPct = Math.min(100, Math.max(0, t.percent_used || 0));
    let fillClass = "";
    if (t.runs_out_early || t.percent_used >= 100) {
      fillClass = "danger";
    } else if (t.percent_used >= 80) {
      fillClass = "warning";
    }

    const warningsHtml = (t.warning_labels && t.warning_labels.length > 0)
      ? t.warning_labels.map((w) => {
          const badgeClass = (w.includes("Runs out") || w.includes("overdue")) ? "badge-danger" : "badge-warning";
          return `<span class="badge ${badgeClass}" style="display: block; margin-bottom: 3px;">${escapeHtml(w)}</span>`;
        }).join("")
      : '<span class="badge badge-paid">On track</span>';

    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(t.name)}</strong>
        <div class="text-muted" style="font-size: 11px;">${escapeHtml(t.plan_name || "Standard")} &bull; ${escapeHtml(t.owner_name || "Team")}</div>
      </td>
      <td>
        <strong>${t.budget_amount} ${escapeHtml(t.unit)}</strong>
        <div class="text-muted" style="font-size: 11px;">$${Number(t.monthly_cost).toFixed(0)}/mo</div>
      </td>
      <td>
        <div><strong>Used:</strong> ${t.used_this_month} ${escapeHtml(t.unit)}</div>
        <div class="text-muted" style="font-size: 11px;"><strong>Left:</strong> ${t.amount_left} ${escapeHtml(t.unit)}</div>
      </td>
      <td>
        <div class="tool-budget-bar" title="${t.percent_used}% used">
          <div class="tool-budget-fill ${fillClass}" style="width: ${clampedPct}%;"></div>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); text-align: right; margin-top: 3px;">
          ${t.percent_used}% used
        </div>
      </td>
      <td>
        <div>${t.daily_pace} ${escapeHtml(t.unit)}/day</div>
        <div class="text-muted" style="font-size: 11px;">Allow: ${t.average_allowed_per_day}/day</div>
      </td>
      <td>
        <div>${escapeHtml(t.renewal_date)} (${t.days_until_renewal}d)</div>
        <div class="text-muted" style="font-size: 11px;">Run-out: ${escapeHtml(t.projected_runout_date)}</div>
      </td>
      <td>
        ${warningsHtml}
      </td>
      <td class="text-right" style="white-space: nowrap;">
        <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end;">
          <button type="button" class="btn btn-primary btn-sm btn-open-tool-usage" data-id="${t.id}">+ Usage</button>
          <button type="button" class="btn btn-secondary btn-sm btn-open-set-total" data-id="${t.id}">Set total</button>
          <button type="button" class="btn btn-secondary btn-sm btn-record-tool-payment" data-id="${t.id}">Pay</button>
        </div>
      </td>
    `;

    const btnUsage = tr.querySelector(".btn-open-tool-usage");
    if (btnUsage) {
      btnUsage.addEventListener("click", () => openToolUsageModal(t));
    }

    const btnSetTotal = tr.querySelector(".btn-open-set-total");
    if (btnSetTotal) {
      btnSetTotal.addEventListener("click", () => openToolSetTotalModal(t));
    }

    const btnPay = tr.querySelector(".btn-record-tool-payment");
    if (btnPay) {
      btnPay.addEventListener("click", () => handleRecordToolPayment(t.id, t.name));
    }

    tbody.appendChild(tr);
  });
}

function openToolUsageModal(tool) {
  const modal = document.getElementById("toolUsageModal");
  if (!modal) return;
  document.getElementById("usageToolId").value = tool.id;
  document.getElementById("toolUsageTitle").textContent = `Log Usage: ${tool.name}`;
  document.getElementById("usageUnitLabel").textContent = tool.unit || "USD";
  document.getElementById("usageDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("usageAmount").value = "";
  document.getElementById("usageNote").value = "";
  document.getElementById("toolUsageError")?.classList.add("hidden");
  modal.classList.remove("hidden");
  document.getElementById("usageAmount")?.focus();
}

function openToolSetTotalModal(tool) {
  const modal = document.getElementById("toolSetTotalModal");
  if (!modal) return;
  document.getElementById("setTotalToolId").value = tool.id;
  document.getElementById("toolSetTotalTitle").textContent = `Set Month Usage: ${tool.name}`;
  document.getElementById("setTotalUnitLabel").textContent = tool.unit || "USD";
  document.getElementById("setTotalAmount").value = tool.used_this_month || 0;
  document.getElementById("setTotalNote").value = "Adjusted cumulative monthly total";
  document.getElementById("toolSetTotalError")?.classList.add("hidden");
  modal.classList.remove("hidden");
  document.getElementById("setTotalAmount")?.focus();
}

async function handleRecordToolPayment(toolId, toolName) {
  if (!confirm(`Record payment for '${toolName}'? This will record the monthly subscription expense in Money and advance the renewal date by 1 month.`)) {
    return;
  }

  const btn = document.querySelector(`.btn-record-tool-payment[data-id="${toolId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Paying...";
  }

  try {
    const res = await fetch(`/api/tools/${toolId}/record-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getStoredAccessCode()
      },
      body: JSON.stringify({ creator_name: state.activeMemberName || "Team" })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to record tool payment.");
    }

    await loadToolsView();
    if (state.currentView === "money") {
      await loadFinances();
    }
    await loadActivityFeed();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Pay";
    }
  }
}

async function handleSaveNewTool(e) {
  e.preventDefault();
  const nameInput = document.getElementById("toolFormName");
  const planInput = document.getElementById("toolFormPlan");
  const costInput = document.getElementById("toolFormCost");
  const budgetInput = document.getElementById("toolFormBudget");
  const unitInput = document.getElementById("toolFormUnit");
  const renewalInput = document.getElementById("toolFormRenewal");
  const ownerInput = document.getElementById("toolFormOwner");
  const notesInput = document.getElementById("toolFormNotes");
  const errorDiv = document.getElementById("toolFormError");

  const name = nameInput.value.trim();
  const plan_name = (planInput ? planInput.value.trim() : "") || "Standard";
  const monthly_cost = parseFloat(costInput.value) || 0;
  const budget_amount = parseFloat(budgetInput ? budgetInput.value : 0) || 0;
  const unit = (unitInput ? unitInput.value.trim() : "USD") || "USD";
  const renewal_date = renewalInput.value.trim();
  const owner_name = ownerInput.value.trim() || state.activeMemberName;
  const notes = notesInput.value.trim();

  if (!name || !renewal_date) {
    errorDiv.textContent = "Please provide tool name and renewal date.";
    errorDiv.classList.remove("hidden");
    return;
  }

  try {
    errorDiv.classList.add("hidden");
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Code": getStoredAccessCode()
      },
      body: JSON.stringify({
        name,
        plan_name,
        budget_amount,
        unit,
        monthly_cost,
        renewal_date,
        owner_name,
        notes,
        creator_name: state.activeMemberName
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to create tool.");
    }

    document.getElementById("toolForm").reset();
    document.getElementById("toolFormCard").classList.add("hidden");
    await loadToolsView();
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.classList.remove("hidden");
  }
}

function setupToolUsageHandlers() {
  const usageModal = document.getElementById("toolUsageModal");
  const btnCloseUsage = document.getElementById("btnCloseToolUsage");
  const btnCancelUsage = document.getElementById("btnCancelUsage");
  const usageForm = document.getElementById("toolUsageForm");
  const usageErr = document.getElementById("toolUsageError");

  const setTotalModal = document.getElementById("toolSetTotalModal");
  const btnCloseSetTotal = document.getElementById("btnCloseToolSetTotal");
  const btnCancelSetTotal = document.getElementById("btnCancelSetTotal");
  const setTotalForm = document.getElementById("toolSetTotalForm");
  const setTotalErr = document.getElementById("toolSetTotalError");

  [btnCloseUsage, btnCancelUsage].forEach((btn) => {
    btn?.addEventListener("click", () => usageModal?.classList.add("hidden"));
  });

  [btnCloseSetTotal, btnCancelSetTotal].forEach((btn) => {
    btn?.addEventListener("click", () => setTotalModal?.classList.add("hidden"));
  });

  if (usageModal) {
    usageModal.addEventListener("click", (e) => {
      if (e.target === usageModal) usageModal.classList.add("hidden");
    });
  }

  if (setTotalModal) {
    setTotalModal.addEventListener("click", (e) => {
      if (e.target === setTotalModal) setTotalModal.classList.add("hidden");
    });
  }

  if (usageForm) {
    usageForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const toolId = parseInt(document.getElementById("usageToolId").value, 10);
      const date = document.getElementById("usageDate").value.trim();
      const amountUsed = parseFloat(document.getElementById("usageAmount").value) || 0;
      const note = document.getElementById("usageNote").value.trim();

      const btn = document.getElementById("btnSaveUsage");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Saving...";
      }

      try {
        if (usageErr) usageErr.classList.add("hidden");
        const res = await fetch(`/api/tools/${toolId}/usage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            tool_id: toolId,
            date: date,
            amount_used: amountUsed,
            note: note,
            creator_name: state.activeMemberName || "Team"
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Failed to log tool usage.");
        }

        usageModal.classList.add("hidden");
        await loadToolsView();
        await loadActivityFeed();
      } catch (err) {
        if (usageErr) {
          usageErr.textContent = err.message;
          usageErr.classList.remove("hidden");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Save usage";
        }
      }
    });
  }

  if (setTotalForm) {
    setTotalForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const toolId = parseInt(document.getElementById("setTotalToolId").value, 10);
      const totalAmount = parseFloat(document.getElementById("setTotalAmount").value) || 0;
      const note = document.getElementById("setTotalNote").value.trim();

      const btn = document.getElementById("btnSaveSetTotal");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Updating...";
      }

      try {
        if (setTotalErr) setTotalErr.classList.add("hidden");
        const res = await fetch(`/api/tools/${toolId}/set-total-usage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            tool_id: toolId,
            total_amount_used: totalAmount,
            note: note,
            creator_name: state.activeMemberName || "Team"
          })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Failed to update total usage.");
        }

        setTotalModal.classList.add("hidden");
        await loadToolsView();
        await loadActivityFeed();
      } catch (err) {
        if (setTotalErr) {
          setTotalErr.textContent = err.message;
          setTotalErr.classList.remove("hidden");
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Update total";
        }
      }
    });
  }
}

function setupStage7Handlers() {
  // Dues month filter
  const duesMonthSelect = document.getElementById("duesMonthSelect");
  if (duesMonthSelect) {
    duesMonthSelect.addEventListener("change", (e) => {
      state.selectedDuesMonth = e.target.value;
      loadDuesView();
    });
  }

  // Tools form toggle & submission
  const btnOpenAddTool = document.getElementById("btnOpenAddTool");
  const toolFormCard = document.getElementById("toolFormCard");
  const btnCancelTool = document.getElementById("btnCancelTool");
  const toolForm = document.getElementById("toolForm");

  if (btnOpenAddTool) {
    btnOpenAddTool.addEventListener("click", () => {
      toolFormCard.classList.remove("hidden");
      document.getElementById("toolForm").reset();
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 30);
      document.getElementById("toolFormRenewal").value = defaultDate.toISOString().slice(0, 10);
      document.getElementById("toolFormName").focus();
    });
  }

  if (btnCancelTool) {
    btnCancelTool.addEventListener("click", () => {
      toolFormCard.classList.add("hidden");
      document.getElementById("toolFormError").classList.add("hidden");
    });
  }

  if (toolForm) {
    toolForm.addEventListener("submit", handleSaveNewTool);
  }

  // Assigned Tasks / Notifications modal toggle
  const btnToggleNotifications = document.getElementById("btnToggleAssignedTasks");
  const modal = document.getElementById("assignedTasksModal");
  const btnCloseModal = document.getElementById("btnCloseAssignedTasks");

  if (btnToggleNotifications && modal) {
    btnToggleNotifications.addEventListener("click", () => {
      renderAssignedTasksModal();
      modal.classList.remove("hidden");
    });
  }

  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener("click", () => {
      modal.classList.add("hidden");
    });
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.classList.add("hidden");
      }
    });
  }

  setupDuesPaymentHandlers();
  setupToolUsageHandlers();
  setupReceiptReaderHandlers();
}

// ==============================================================================
// Stage 8 Part 5: Tool Receipt Reader Handlers
// ==============================================================================
function setupReceiptReaderHandlers() {
  const btnToggle = document.getElementById("btnToggleReceiptReader");
  const card = document.getElementById("receiptReaderCard");
  const btnCancel = document.getElementById("btnCancelReceipt");
  const btnParse = document.getElementById("btnParseReceipt");
  const textInput = document.getElementById("receiptTextInput");
  const loadingEl = document.getElementById("receiptLoading");
  const errorEl = document.getElementById("receiptError");
  const resultCard = document.getElementById("receiptResultCard");
  const saveForm = document.getElementById("receiptSaveForm");
  const saveSuccess = document.getElementById("receiptSaveSuccess");
  const saveBtn = document.getElementById("btnSaveReceiptTool");

  if (btnToggle && card) {
    btnToggle.addEventListener("click", () => {
      card.classList.toggle("hidden");
      if (!card.classList.contains("hidden")) {
        textInput?.focus();
      }
    });
  }

  if (btnCancel && card) {
    btnCancel.addEventListener("click", () => {
      card.classList.add("hidden");
      if (errorEl) errorEl.classList.add("hidden");
      if (resultCard) resultCard.classList.add("hidden");
    });
  }

  if (btnParse) {
    btnParse.addEventListener("click", async () => {
      const text = textInput ? textInput.value.trim() : "";
      if (!text) {
        if (errorEl) {
          errorEl.textContent = "Please paste the subscription email or invoice text.";
          errorEl.classList.remove("hidden");
        }
        return;
      }

      btnParse.disabled = true;
      btnParse.textContent = "Extracting...";
      if (loadingEl) loadingEl.classList.remove("hidden");
      if (errorEl) errorEl.classList.add("hidden");
      if (resultCard) resultCard.classList.add("hidden");

      try {
        const res = await fetch("/api/ai/parse-receipt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({ receipt_text: text })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to extract tool details.");
        }

        const data = await res.json();

        // Populate form
        document.getElementById("receiptToolName").value = data.tool_name || "";
        document.getElementById("receiptPlanName").value = data.plan_name || "Standard";
        document.getElementById("receiptAmount").value = data.amount || 0;
        document.getElementById("receiptUnit").value = data.currency || "USD";
        document.getElementById("receiptRenewalDate").value = data.renewal_date || "";
        document.getElementById("receiptOwner").value = state.activeMemberName || "Team";
        document.getElementById("receiptNotes").value = data.notes || "";

        if (resultCard) resultCard.classList.remove("hidden");
        document.getElementById("receiptToolName")?.focus();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.remove("hidden");
        }
      } finally {
        btnParse.disabled = false;
        btnParse.textContent = "Extract with Gemma";
        if (loadingEl) loadingEl.classList.add("hidden");
      }
    });
  }

  if (saveForm) {
    saveForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const toolName = document.getElementById("receiptToolName").value.trim();
      const planName = document.getElementById("receiptPlanName").value.trim();
      const amount = parseFloat(document.getElementById("receiptAmount").value) || 0;
      const unit = document.getElementById("receiptUnit").value.trim() || "USD";
      const renewalDate = document.getElementById("receiptRenewalDate").value.trim();
      const owner = document.getElementById("receiptOwner").value.trim() || state.activeMemberName;
      const notes = document.getElementById("receiptNotes").value.trim();
      const recordExpense = document.getElementById("receiptRecordExpense")?.checked || false;

      if (!toolName) {
        if (errorEl) {
          errorEl.textContent = "Tool name is required.";
          errorEl.classList.remove("hidden");
        }
        return;
      }

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
      }

      try {
        if (errorEl) errorEl.classList.add("hidden");
        const res = await fetch("/api/tools/save-from-receipt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            name: toolName,
            plan_name: planName,
            monthly_cost: amount,
            budget_amount: amount,
            unit: unit,
            renewal_date: renewalDate,
            owner_name: owner,
            notes: notes,
            record_expense: recordExpense,
            creator_name: state.activeMemberName || "Team"
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to save tool.");
        }

        if (saveSuccess) {
          saveSuccess.classList.remove("hidden");
          setTimeout(() => saveSuccess.classList.add("hidden"), 3000);
        }

        saveForm.reset();
        if (textInput) textInput.value = "";
        if (resultCard) resultCard.classList.add("hidden");
        if (card) card.classList.add("hidden");

        await loadToolsView();
        if (recordExpense) {
          await loadFinances();
        }
        await loadActivityFeed();
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.remove("hidden");
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save tool";
        }
      }
    });
  }
}

// ==============================================================================
// Stage 8 Part 6: Monthly Report Handlers
// ==============================================================================
let reportDataCache = null;

async function loadReportView() {
  const monthSelect = document.getElementById("reportMonthSelect");
  const selectedMonth = monthSelect ? monthSelect.value : (state.selectedFinanceMonth || "2026-10");

  try {
    const res = await fetch(`/api/report?month=${selectedMonth}`, {
      headers: {
        "X-Access-Code": getStoredAccessCode()
      }
    });
    if (!res.ok) throw new Error("Failed to load monthly report data");
    const data = await res.json();
    reportDataCache = data;

    // Populate month options
    if (monthSelect && data.available_months && data.available_months.length > 0) {
      const cur = data.month || selectedMonth;
      monthSelect.innerHTML = "";
      data.available_months.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === cur) opt.selected = true;
        monthSelect.appendChild(opt);
      });
    }

    const printSub = document.getElementById("printReportSubtitle");
    if (printSub) {
      printSub.textContent = `Generated for ${data.month}`;
    }

    renderReportView(data);
  } catch (err) {
    console.error("Error loading report:", err);
  }
}

function renderReportView(data) {
  // 1. KPI Cards
  const tasksCompEl = document.getElementById("reportMetricTasksCompleted");
  const tasksCreatedEl = document.getElementById("reportMetricTasksCreated");
  if (tasksCompEl) tasksCompEl.textContent = `${data.tasks.completed_count} completed`;
  if (tasksCreatedEl) tasksCreatedEl.textContent = `${data.tasks.created_count} created in ${data.month}`;

  const payCollEl = document.getElementById("reportMetricPaymentsCollected");
  const payExpEl = document.getElementById("reportMetricPaymentsExpected");
  if (payCollEl) payCollEl.textContent = `$${data.payments.total_received.toFixed(0)}`;
  if (payExpEl) payExpEl.textContent = `$${data.payments.total_expected.toFixed(0)} expected ($${data.payments.total_pending.toFixed(0)} pending)`;

  const toolSpendEl = document.getElementById("reportMetricToolSpend");
  const toolBudEl = document.getElementById("reportMetricToolBudget");
  if (toolSpendEl) toolSpendEl.textContent = `$${data.tools.total_spend.toFixed(0)}`;
  if (toolBudEl) toolBudEl.textContent = `$${data.tools.total_budget.toFixed(0)} total budget`;

  const actCountEl = document.getElementById("reportMetricActivityCount");
  if (actCountEl) actCountEl.textContent = `${data.activity.total_count} actions`;

  // 2. Tasks by Client Table
  const clientTbody = document.getElementById("reportTasksByClientBody");
  if (clientTbody) {
    const clients = Object.keys(data.tasks.by_client || {});
    if (clients.length === 0) {
      clientTbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">No client tasks recorded this month.</td></tr>';
    } else {
      clientTbody.innerHTML = clients.map((c) => {
        const item = data.tasks.by_client[c];
        const rate = item.created > 0 ? Math.round((item.completed / item.created) * 100) : 0;
        return `
          <tr>
            <td><strong>${escapeHtml(c)}</strong></td>
            <td style="text-align: center;">${item.created}</td>
            <td style="text-align: center;"><strong>${item.completed}</strong></td>
            <td style="text-align: right;"><span class="badge ${rate === 100 ? "badge-paid" : "badge-status"}">${rate}%</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  // 3. Tasks by Member Table
  const memberTbody = document.getElementById("reportTasksByMemberBody");
  if (memberTbody) {
    const members = Object.keys(data.tasks.by_member || {});
    if (members.length === 0) {
      memberTbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center py-3">No tasks assigned or created this month.</td></tr>';
    } else {
      memberTbody.innerHTML = members.map((m) => {
        const item = data.tasks.by_member[m];
        const rate = item.created > 0 ? Math.round((item.completed / item.created) * 100) : 0;
        return `
          <tr>
            <td><strong>${escapeHtml(m)}</strong></td>
            <td style="text-align: center;">${item.created}</td>
            <td style="text-align: center;"><strong>${item.completed}</strong></td>
            <td style="text-align: right;"><span class="badge ${rate === 100 ? "badge-paid" : "badge-status"}">${rate}%</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  // 4. Client Payments Table
  const payTbody = document.getElementById("reportPaymentsBody");
  if (payTbody) {
    const pendingList = data.payments.pending_clients || [];
    if (pendingList.length === 0) {
      payTbody.innerHTML = '<tr><td colspan="6" class="text-center py-3" style="color: var(--primary); font-weight: 700;">&#10003; All client retainers fully collected!</td></tr>';
    } else {
      payTbody.innerHTML = pendingList.map((p) => {
        let badgeClass = "badge-pending";
        if (p.status === "paid") badgeClass = "badge-paid";
        else if (p.status === "partial") badgeClass = "badge-partial";
        else if (p.status === "overdue") badgeClass = "badge-overdue";

        return `
          <tr>
            <td><strong>${escapeHtml(p.client_name)}</strong></td>
            <td>$${p.amount_expected.toFixed(0)}</td>
            <td>$${p.amount_received.toFixed(0)}</td>
            <td><strong class="metric-expense">$${p.balance.toFixed(0)}</strong></td>
            <td>${escapeHtml(p.due_date)}</td>
            <td><span class="badge ${badgeClass}">${escapeHtml(p.status.toUpperCase())}</span></td>
          </tr>
        `;
      }).join("");
    }
  }

  // 5. Tools Table
  const toolTbody = document.getElementById("reportToolsBody");
  if (toolTbody) {
    const tools = data.tools.tools_list || [];
    if (tools.length === 0) {
      toolTbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-3">No software tools recorded.</td></tr>';
    } else {
      toolTbody.innerHTML = tools.map((t) => {
        let badgeClass = "badge-paid";
        if (t.percent_used >= 100) badgeClass = "badge-danger";
        else if (t.percent_used >= 80) badgeClass = "badge-warning";

        return `
          <tr>
            <td>
              <strong>${escapeHtml(t.name)}</strong>
              <div class="text-muted" style="font-size: 11px;">${escapeHtml(t.plan_name)}</div>
            </td>
            <td>$${t.monthly_cost.toFixed(0)}/mo</td>
            <td>${t.budget_amount} ${escapeHtml(t.unit)}</td>
            <td><strong>${t.used} ${escapeHtml(t.unit)}</strong></td>
            <td>${t.left} ${escapeHtml(t.unit)}</td>
            <td><span class="badge ${badgeClass}">${t.percent_used}% used</span></td>
            <td>${escapeHtml(t.renewal_date)}</td>
          </tr>
        `;
      }).join("");
    }
  }
}

function setupReportHandlers() {
  const monthSelect = document.getElementById("reportMonthSelect");
  if (monthSelect) {
    monthSelect.addEventListener("change", () => {
      loadReportView();
    });
  }

  const btnWrite = document.getElementById("btnWriteReportSummary");
  const summaryBox = document.getElementById("reportSummaryBox");
  const loadingIndicator = document.getElementById("summaryLoadingIndicator");
  const errorMsg = document.getElementById("summaryErrorMsg");

  if (btnWrite) {
    btnWrite.addEventListener("click", async () => {
      if (!reportDataCache) {
        await loadReportView();
      }
      if (!reportDataCache) return;

      btnWrite.disabled = true;
      btnWrite.textContent = "Writing...";
      if (loadingIndicator) loadingIndicator.classList.remove("hidden");
      if (errorMsg) errorMsg.classList.add("hidden");

      // Send ONLY aggregated numbers to Gemma
      const aggregatedMetrics = {
        month: reportDataCache.month,
        tasks_created: reportDataCache.tasks.created_count,
        tasks_completed: reportDataCache.tasks.completed_count,
        payments_expected: reportDataCache.payments.total_expected,
        payments_received: reportDataCache.payments.total_received,
        payments_pending: reportDataCache.payments.total_pending,
        pending_clients_count: (reportDataCache.payments.pending_clients || []).length,
        tool_spend: reportDataCache.tools.total_spend,
        tool_total_budget: reportDataCache.tools.total_budget,
        activity_count: reportDataCache.activity.total_count
      };

      try {
        const res = await fetch("/api/ai/report-summary", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            month: reportDataCache.month,
            metrics: aggregatedMetrics
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to generate AI executive summary.");
        }

        const data = await res.json();
        if (summaryBox) {
          summaryBox.value = data.summary || "";
          summaryBox.focus();
        }
      } catch (err) {
        if (errorMsg) {
          errorMsg.textContent = `${err.message} (Database numbers are still available below).`;
          errorMsg.classList.remove("hidden");
        }
      } finally {
        btnWrite.disabled = false;
        btnWrite.textContent = "\u2728 Write summary";
        if (loadingIndicator) loadingIndicator.classList.add("hidden");
      }
    });
  }

  const btnCopy = document.getElementById("btnCopyReport");
  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      if (!reportDataCache) {
        await loadReportView();
      }
      if (!reportDataCache) return;

      const summaryText = summaryBox ? summaryBox.value.trim() : "";
      const textToCopy = formatReportAsText(reportDataCache, summaryText);

      try {
        await navigator.clipboard.writeText(textToCopy);
        const origText = btnCopy.textContent;
        btnCopy.textContent = "\u2713 Copied!";
        setTimeout(() => {
          btnCopy.textContent = origText;
        }, 2000);
      } catch (err) {
        window.prompt("Copy report text:", textToCopy);
      }
    });
  }

  const btnPrint = document.getElementById("btnPrintReport");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => {
      window.print();
    });
  }
}

function formatReportAsText(data, summary) {
  let text = `==============================================\n`;
  text += `NEWVORA HQ - MONTHLY EXECUTIVE REPORT (${data.month})\n`;
  text += `==============================================\n\n`;

  if (summary) {
    text += `EXECUTIVE SUMMARY:\n${summary}\n\n`;
  }

  text += `KEY METRICS:\n`;
  text += `- Tasks Deliverables: ${data.tasks.completed_count} completed / ${data.tasks.created_count} created\n`;
  text += `- Client Collections: $${data.payments.total_received.toFixed(0)} received of $${data.payments.total_expected.toFixed(0)} expected ($${data.payments.total_pending.toFixed(0)} pending)\n`;
  text += `- Tool Subscriptions: $${data.tools.total_spend.toFixed(0)} spent this month ($${data.tools.total_budget.toFixed(0)} total monthly budget)\n`;
  text += `- Audit Actions Logged: ${data.activity.total_count}\n\n`;

  text += `TASKS BY CLIENT:\n`;
  const clients = Object.keys(data.tasks.by_client || {});
  if (clients.length === 0) {
    text += `No tasks recorded.\n`;
  } else {
    clients.forEach((c) => {
      const item = data.tasks.by_client[c];
      const rate = item.created > 0 ? Math.round((item.completed / item.created) * 100) : 0;
      text += `- ${c}: ${item.completed}/${item.created} completed (${rate}%)\n`;
    });
  }
  text += `\n`;

  text += `CLIENT PAYMENTS & PENDING DUES:\n`;
  const pendings = data.payments.pending_clients || [];
  if (pendings.length === 0) {
    text += `All client retainers settled.\n`;
  } else {
    pendings.forEach((p) => {
      text += `- ${p.client_name}: $${p.amount_received.toFixed(0)} received, $${p.balance.toFixed(0)} balance (${p.status.toUpperCase()})\n`;
    });
  }
  text += `\n`;

  text += `TOOL SUBSCRIPTIONS & USAGE:\n`;
  const tools = data.tools.tools_list || [];
  if (tools.length === 0) {
    text += `No tools recorded.\n`;
  } else {
    tools.forEach((t) => {
      text += `- ${t.name} (${t.plan_name}): ${t.used}/${t.budget_amount} ${t.unit} used (${t.percent_used}%), $${t.monthly_cost.toFixed(0)}/mo\n`;
    });
  }

  text += `\nGenerated by Newvora HQ`;
  return text;
}

function setupDuesPaymentHandlers() {
  const form = document.getElementById("duesPaymentForm");
  const card = document.getElementById("duesPaymentCard");
  const btnCancel = document.getElementById("btnCancelPayment");
  const errEl = document.getElementById("duesPaymentError");

  const historyModal = document.getElementById("paymentHistoryModal");
  const btnCloseHistory = document.getElementById("btnClosePaymentHistory");

  if (btnCancel && card) {
    btnCancel.addEventListener("click", () => {
      card.classList.add("hidden");
      if (errEl) errEl.classList.add("hidden");
    });
  }

  if (btnCloseHistory && historyModal) {
    btnCloseHistory.addEventListener("click", () => {
      historyModal.classList.add("hidden");
    });
  }

  if (historyModal) {
    historyModal.addEventListener("click", (e) => {
      if (e.target === historyModal) {
        historyModal.classList.add("hidden");
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const clientId = parseInt(document.getElementById("paymentClientId").value, 10);
      const month = document.getElementById("paymentMonth").value.trim();
      const amountExpected = parseFloat(document.getElementById("paymentAmountExpected").value) || 0;
      const amountReceived = parseFloat(document.getElementById("paymentAmountReceived").value) || 0;
      const dateReceived = document.getElementById("paymentDateReceived").value.trim();
      const method = document.getElementById("paymentMethod").value.trim();
      const note = document.getElementById("paymentNote").value.trim();

      const saveBtn = document.getElementById("btnSavePayment");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";
      }

      try {
        if (errEl) errEl.classList.add("hidden");
        const res = await fetch("/api/client-payments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Access-Code": getStoredAccessCode()
          },
          body: JSON.stringify({
            client_id: clientId,
            month: month,
            amount_expected: amountExpected,
            amount_received: amountReceived,
            date_received: dateReceived,
            method: method,
            note: note,
            creator_name: state.activeMemberName || "Team"
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to save client payment.");
        }

        if (card) card.classList.add("hidden");
        await loadDuesView();
        if (state.currentView === "money") {
          await loadFinances();
        }
        await loadActivityFeed();
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message;
          errEl.classList.remove("hidden");
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save payment";
        }
      }
    });
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
    loadAiModelBadge();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    input.select();
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock Workspace";
  }
}

// ==============================================================================
// AI Model Badge
// ==============================================================================
async function loadAiModelBadge() {
  const badge = document.getElementById("aiModelBadge");
  if (!badge) return;

  const fallbackText = "Gemma via Gemini API";

  try {
    const headers = {};
    const accessCode = getStoredAccessCode();
    if (accessCode) {
      headers["X-Access-Code"] = accessCode;
    }

    const res = await fetch("/api/ai/model-info", { headers });
    if (!res.ok) {
      badge.textContent = fallbackText;
      return;
    }

    const data = await res.json();
    const model = (data && data.model ? String(data.model) : "").trim();
    const provider = (data && data.provider ? String(data.provider) : "").trim().toLowerCase();

    if (!model) {
      badge.textContent = fallbackText;
      return;
    }

    let providerLabel = "Gemini API";
    if (provider === "ollama") {
      providerLabel = "Ollama";
    } else if (provider === "gemini") {
      providerLabel = "Gemini API";
    } else if (provider) {
      providerLabel = provider.toUpperCase();
    }

    badge.textContent = `${model} via ${providerLabel}`;
  } catch (err) {
    badge.textContent = fallbackText;
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
      loadAiModelBadge();
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

  // 7. Stage 7 Dues, Tools & Notification handlers
  setupStage7Handlers();
  setupNotificationsCenterHandlers();
  setupReportHandlers();

  const btnRefreshActivity = document.getElementById("btnRefreshActivity");
  if (btnRefreshActivity) {
    btnRefreshActivity.addEventListener("click", loadActivityFeed);
  }

  // 8. Initial data load
  loadMembers();
  loadClients();
  loadNotificationsCenter();
  loadAiModelBadge();
}

// ==============================================================================
// Light / Dark Theme Management
// ==============================================================================
function initTheme() {
  const toggleBtn = document.getElementById("btnThemeToggle");
  const toggleBtnMobile = document.getElementById("btnThemeToggleMobile");

  function getActiveTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  function updateToggleUI(theme) {
    const isDark = theme === "dark";
    const label = isDark ? "Switch to light theme" : "Switch to dark theme";

    [toggleBtn, toggleBtnMobile].forEach((btn) => {
      if (!btn) return;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", label);
      const sunIcon = btn.querySelector(".theme-icon-sun");
      const moonIcon = btn.querySelector(".theme-icon-moon");
      if (sunIcon && moonIcon) {
        if (isDark) {
          sunIcon.classList.remove("hidden");
          moonIcon.classList.add("hidden");
        } else {
          sunIcon.classList.add("hidden");
          moonIcon.classList.remove("hidden");
        }
      }
    });

    const metaTheme = document.getElementById("metaThemeColor");
    if (metaTheme) {
      metaTheme.setAttribute("content", isDark ? "#121615" : "#F1EFE7");
    }
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("newvora_theme", theme);
    } catch (e) {
      // storage blocked or private mode
    }
    updateToggleUI(theme);
  }

  function toggleTheme() {
    const current = getActiveTheme();
    const next = current === "dark" ? "light" : "dark";
    setTheme(next);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleTheme);
  }
  if (toggleBtnMobile) {
    toggleBtnMobile.addEventListener("click", toggleTheme);
  }

  // Sync initial UI with currently active theme
  updateToggleUI(getActiveTheme());

  // Listen to system preference changes if no manual preference stored
  if (window.matchMedia) {
    try {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", (e) => {
        try {
          if (!localStorage.getItem("newvora_theme")) {
            setTheme(e.matches ? "dark" : "light");
          }
        } catch (err) {}
      });
    } catch (err) {}
  }
}

// ==============================================================================
// Initial Setup & Event Listeners
// ==============================================================================
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  const accessGateForm = document.getElementById("accessGateForm");
  if (accessGateForm) {
    accessGateForm.addEventListener("submit", handleAccessGateSubmit);
  }
  checkAccessAndInit();
});
