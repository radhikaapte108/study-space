const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const accountBar = document.querySelector('#account-bar');
const authForm = document.querySelector('#auth-form');
const authMessage = document.querySelector('#auth-message');
const authHeading = document.querySelector('#auth-heading');
const authSubheading = document.querySelector('#auth-subheading');
const authNameField = document.querySelector('#name-field');
const authName = document.querySelector('#auth-name');
const authPassword = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const loginTab = document.querySelector('#login-tab');
const registerTab = document.querySelector('#register-tab');
const assignmentForm = document.querySelector('#assignment-form');
const assignmentList = document.querySelector('#assignment-list');
const formHeading = document.querySelector('#form-heading');
const submitButton = document.querySelector('#submit-button');
const cancelEditButton = document.querySelector('#cancel-edit');
const formMessage = document.querySelector('#form-message');
const listMessage = document.querySelector('#list-message');
const statusFilter = document.querySelector('#status-filter');
const assignmentCount = document.querySelector('#assignment-count');
const searchInput = document.querySelector('#assignment-search');

let editingId = null;
let authMode = 'login';
let csrfToken = '';
let assignments = [];
let currentUser = null;

async function request(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(options.method || 'GET')) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Something went wrong.');
  return data;
}

function showSignedOut() {
  currentUser = null;
  assignments = [];
  editingId = null;
  accountBar.classList.add('hidden');
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  assignmentList.replaceChildren();
  setAuthMode('login');
}

function showSignedIn(user) {
  currentUser = user;
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  accountBar.classList.remove('hidden');
  document.querySelector('#user-name').textContent = user.name;
  document.querySelector('#user-avatar').textContent = user.name.trim().charAt(0).toUpperCase();
  document.querySelector('#page-title').textContent = '';
  document.querySelector('#page-title').append(document.createTextNode('Good work starts here'));
  const period = document.createElement('span');
  period.className = 'title-period';
  period.textContent = '.';
  document.querySelector('#page-title').append(period);
  loadAssignments();
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';
  authNameField.classList.toggle('hidden', !registering);
  authName.required = registering;
  authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  authPassword.minLength = registering ? 10 : 1;
  authHeading.textContent = registering ? 'Create your account' : 'Welcome back';
  authSubheading.textContent = registering
    ? 'A personal space for everything on your plate.'
    : 'Sign in to pick up where you left off.';
  authSubmit.textContent = registering ? 'Create my account' : 'Sign in';
  loginTab.classList.toggle('active', !registering);
  registerTab.classList.toggle('active', registering);
  loginTab.setAttribute('aria-selected', String(!registering));
  registerTab.setAttribute('aria-selected', String(registering));
  authMessage.textContent = '';
}

function addTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function formatDeadline(value) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function makeBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`;
  badge.textContent = text;
  return badge;
}

function createAssignmentCard(assignment) {
  const card = document.createElement('article');
  card.className = 'assignment-card';

  const top = document.createElement('div');
  top.className = 'card-top';
  const titleBlock = document.createElement('div');
  addTextElement(titleBlock, 'p', 'subject-name', assignment.subject);
  addTextElement(titleBlock, 'h3', 'assignment-title', assignment.title);
  top.append(titleBlock);

  const badges = document.createElement('div');
  badges.className = 'badge-row';
  const statusClass = `status-${assignment.status.toLowerCase().replaceAll(' ', '-')}`;
  const priorityClass = `priority-${assignment.priority.toLowerCase()}`;
  const displayStatus = assignment.status === 'Pending'
    ? 'Not started'
    : assignment.status === 'Partially completed' ? 'Partially completed' : 'Completed';
  badges.append(makeBadge(displayStatus, statusClass), makeBadge(`${assignment.priority} priority`, priorityClass));
  top.append(badges);
  card.append(top);

  if (assignment.description) addTextElement(card, 'p', 'assignment-description', assignment.description);

  const bottom = document.createElement('div');
  bottom.className = 'card-bottom';
  const dueDate = document.createElement('span');
  dueDate.className = 'deadline';
  dueDate.textContent = `Due ${formatDeadline(assignment.deadline)}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(`${assignment.deadline.slice(0, 10)}T00:00:00`);
  if (assignment.status !== 'Completed' && deadline < today) {
    dueDate.classList.add('deadline-overdue');
    dueDate.textContent += ' · Overdue';
  }
  bottom.append(dueDate);

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const toggleButton = document.createElement('button');
  toggleButton.type = 'button';
  toggleButton.className = 'text-button';
  toggleButton.dataset.action = 'toggle';
  toggleButton.dataset.id = assignment._id;
  toggleButton.textContent = assignment.status === 'Completed' ? 'Mark not started' : 'Mark complete';
  actions.append(toggleButton);

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'text-button';
  editButton.dataset.action = 'edit';
  editButton.dataset.id = assignment._id;
  editButton.textContent = 'Edit';
  actions.append(editButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'text-button delete-button';
  deleteButton.dataset.action = 'delete';
  deleteButton.dataset.id = assignment._id;
  deleteButton.textContent = 'Delete';
  actions.append(deleteButton);

  bottom.append(actions);
  card.append(bottom);
  return card;
}

function renderEmptyState() {
  const hasAssignments = assignments.length > 0;
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  addTextElement(empty, 'div', 'empty-icon', hasAssignments ? '⌕' : '✳');
  addTextElement(empty, 'h3', '', hasAssignments ? 'No matches found' : 'Your plan starts here');
  addTextElement(empty, 'p', '', hasAssignments
    ? 'Try a different search or status filter.'
    : 'Add your first assignment and make your next step feel simple.');
  if (!hasAssignments) {
    const addButton = addTextElement(empty, 'button', 'text-button empty-add-button', 'Add an assignment');
    addButton.type = 'button';
    addButton.dataset.action = 'new';
  }
  assignmentList.append(empty);
}

function updateStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const pending = assignments.filter((item) => item.status !== 'Completed');
  const dueSoon = pending.filter((item) => {
    const deadline = new Date(`${item.deadline.slice(0, 10)}T00:00:00`);
    return deadline >= today && deadline <= nextWeek;
  });
  document.querySelector('#stat-total').textContent = String(assignments.length);
  document.querySelector('#stat-pending').textContent = String(pending.length);
  document.querySelector('#stat-completed').textContent = String(assignments.length - pending.length);
  document.querySelector('#stat-due-soon').textContent = String(dueSoon.length);
}

function renderAssignments() {
  assignmentList.replaceChildren();
  const status = statusFilter.value;
  const search = searchInput.value.trim().toLowerCase();
  const visibleAssignments = assignments.filter((assignment) => {
    const matchesStatus = status === 'All' || assignment.status === status;
    const searchableText = `${assignment.subject} ${assignment.title} ${assignment.description || ''}`.toLowerCase();
    return matchesStatus && searchableText.includes(search);
  });
  assignmentCount.textContent = `${visibleAssignments.length} ${visibleAssignments.length === 1 ? 'item' : 'items'}`;

  if (visibleAssignments.length === 0) {
    renderEmptyState();
    return;
  }
  visibleAssignments.forEach((assignment) => assignmentList.append(createAssignmentCard(assignment)));
}

async function loadAssignments() {
  listMessage.textContent = '';
  assignmentList.replaceChildren();
  assignmentCount.textContent = 'Loading…';

  try {
    assignments = await request('/api/assignments');
    updateStats();
    renderAssignments();
  } catch (error) {
    if (error.message === 'Please sign in to continue.') {
      showSignedOut();
      return;
    }
    assignmentCount.textContent = '—';
    listMessage.textContent = `Unable to load assignments: ${error.message}`;
  }
}

function resetForm() {
  assignmentForm.reset();
  document.querySelector('#priority').value = 'Medium';
  document.querySelector('#status').value = 'Pending';
  editingId = null;
  formHeading.textContent = 'Add an assignment';
  submitButton.textContent = 'Add to my plan';
  cancelEditButton.classList.add('hidden');
  formMessage.textContent = '';
}

function beginEdit(assignment) {
  editingId = assignment._id;
  assignmentForm.elements.subject.value = assignment.subject;
  assignmentForm.elements.title.value = assignment.title;
  assignmentForm.elements.description.value = assignment.description || '';
  assignmentForm.elements.deadline.value = assignment.deadline.slice(0, 10);
  assignmentForm.elements.priority.value = assignment.priority;
  assignmentForm.elements.status.value = assignment.status;
  formHeading.textContent = 'Edit assignment';
  submitButton.textContent = 'Save changes';
  cancelEditButton.classList.remove('hidden');
  formMessage.textContent = '';
  document.querySelector('#subject').focus();
  document.querySelector('#form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

loginTab.addEventListener('click', () => setAuthMode('login'));
registerTab.addEventListener('click', () => setAuthMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authMessage.textContent = '';
  authSubmit.disabled = true;
  authSubmit.textContent = authMode === 'register' ? 'Creating account…' : 'Signing in…';

  const formData = new FormData(authForm);
  const payload = {
    email: formData.get('email'),
    password: formData.get('password')
  };
  if (authMode === 'register') payload.name = formData.get('name');

  try {
    const result = await request(`/api/auth/${authMode}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    csrfToken = result.csrfToken;
    authForm.reset();
    showSignedIn(result.user);
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = authMode === 'register' ? 'Create my account' : 'Sign in';
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST' });
    await initializeSession();
  } catch (error) {
    listMessage.textContent = error.message;
  }
});

assignmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = '';

  const assignment = Object.fromEntries(new FormData(assignmentForm).entries());
  const isEditing = Boolean(editingId);
  const url = isEditing ? `/api/assignments/${editingId}` : '/api/assignments';

  try {
    await request(url, {
      method: isEditing ? 'PUT' : 'POST',
      body: JSON.stringify(assignment)
    });
    resetForm();
    await loadAssignments();
  } catch (error) {
    if (error.message === 'Please sign in to continue.') showSignedOut();
    else formMessage.textContent = error.message;
  }
});

cancelEditButton.addEventListener('click', resetForm);
statusFilter.addEventListener('change', renderAssignments);
searchInput.addEventListener('input', renderAssignments);
document.querySelector('#add-assignment-shortcut').addEventListener('click', () => {
  document.querySelector('#subject').focus();
  document.querySelector('#form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

assignmentList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  if (button.dataset.action === 'new') {
    document.querySelector('#subject').focus();
    document.querySelector('#form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  const { action, id } = button.dataset;
  try {
    if (action === 'edit') {
      const assignment = await request(`/api/assignments/${id}`);
      beginEdit(assignment);
    } else if (action === 'toggle') {
      const currentStatus = button.textContent === 'Mark complete' ? 'Completed' : 'Pending';
      await request(`/api/assignments/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: currentStatus })
      });
      await loadAssignments();
    } else if (action === 'delete') {
      if (!window.confirm('Delete this assignment? This cannot be undone.')) return;
      await request(`/api/assignments/${id}`, { method: 'DELETE' });
      if (editingId === id) resetForm();
      await loadAssignments();
    }
  } catch (error) {
    if (error.message === 'Please sign in to continue.') showSignedOut();
    else listMessage.textContent = error.message;
  }
});

async function initializeSession() {
  try {
    const result = await request('/api/auth/session');
    csrfToken = result.csrfToken;
    if (result.user) showSignedIn(result.user);
    else showSignedOut();
  } catch (error) {
    authMessage.textContent = `Unable to connect: ${error.message}`;
  }
}

initializeSession();
