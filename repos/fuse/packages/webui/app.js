const API = '/api/v1';
let state = { token: null, identity: null, domains: [], channels: [], currentDomainId: null, currentChannelId: null, messages: [] };

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'onclick' || k.startsWith('on')) e[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v);
  }
  for (const c of children) { if (c != null) e.append(typeof c === 'string' ? document.createTextNode(c) : c); }
  return e;
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && state.token) { state.token = null; localStorage.removeItem('fuse_token'); render(); return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Request failed');
  return data;
}

function saveToken(token) { state.token = token; localStorage.setItem('fuse_token', token); }
function loadToken() { return localStorage.getItem('fuse_token'); }

async function init() {
  const saved = loadToken();
  if (saved) {
    state.token = saved;
    try {
      state.identity = await api('GET', '/identities/me');
      await loadDomains();
      render();
    } catch { state.token = null; localStorage.removeItem('fuse_token'); render(); }
  } else { render(); }
}

async function loadDomains() {
  state.domains = [];
  state.channels = [];
  try {
    state.domains = await api('GET', '/domains') || [];
    if (state.domains.length > 0) {
      state.currentDomainId = state.domains[0].id;
      await loadChannels();
    }
  } catch (e) { console.error('load domains error:', e); }
}

async function loadChannels() {
  if (!state.currentDomainId) { state.channels = []; return; }
  state.channels = await api('GET', `/channels?domainId=${state.currentDomainId}`) || [];
}

async function loadMessages() {
  if (!state.currentChannelId) { state.messages = []; return; }
  state.messages = await api('GET', `/channels/${state.currentChannelId}/messages`) || [];
}

function render() {
  const app = $('#app');
  if (!state.token || !state.identity) { renderAuth(app); return; }
  renderApp(app);
}

function renderAuth(container) {
  container.innerHTML = '';
  const mode = { register: true };
  const card = el('div', { className: 'auth-page' },
    el('div', { className: 'auth-card' },
      el('h1', {}, 'FUSE'),
      el('p', {}, 'SMTP-Native Chat & Federation Server'),
      el('div', { id: 'auth-form' }),
    )
  );
  container.append(card);

  function buildForm() {
    const form = $('#auth-form');
    form.innerHTML = '';
    if (mode.register) {
      form.append(
        el('div', { className: 'form-group' }, el('label', {}, 'Domain'), el('input', { id: 'reg-domain', value: 'fuse.ffilt.us', placeholder: 'your.domain' })),
        el('div', { className: 'form-group' }, el('label', {}, 'Handle'), el('input', { id: 'reg-handle', placeholder: 'you' })),
        el('div', { className: 'form-group' }, el('label', {}, 'Display Name'), el('input', { id: 'reg-name', placeholder: 'Your Name' })),
        el('div', { className: 'form-group' }, el('label', {}, 'Type'), el('select', { id: 'reg-type' }, el('option', { value: 'human' }, 'Human'), el('option', { value: 'agent' }, 'Agent'), el('option', { value: 'service' }, 'Service'))),
        el('button', { className: 'primary', id: 'reg-btn' }, 'Register'),
        el('div', { className: 'error-msg', id: 'auth-error' }),
        el('div', { className: 'toggle-mode' }, 'Already registered? ', el('a', { href: '#', id: 'toggle-auth' }, 'Use existing token')),
      );
      $('#reg-btn').onclick = async () => {
        const domainName = $('#reg-domain').value.trim();
        const handle = $('#reg-handle').value.trim();
        const displayName = $('#reg-name').value.trim();
        const type = $('#reg-type').value;
        if (!handle || !displayName) { $('#auth-error').textContent = 'Handle and display name are required'; $('#auth-error').style.display = 'block'; return; }
        try {
          const res = await api('POST', '/auth/register', { domainName, handle, displayName, type });
          saveToken(res.token);
          state.identity = res.identity;
          await loadDomains();
          render();
        } catch (e) {
          $('#auth-error').textContent = e.message;
          $('#auth-error').style.display = 'block';
        }
      };
    } else {
      form.append(
        el('div', { className: 'form-group' }, el('label', {}, 'Session Token'), el('textarea', { id: 'token-input', rows: 3, placeholder: 'Paste your Bearer token...' })),
        el('button', { className: 'primary', id: 'login-btn' }, 'Use Token'),
        el('div', { className: 'error-msg', id: 'auth-error' }),
        el('div', { className: 'toggle-mode' }, 'No token? ', el('a', { href: '#', id: 'toggle-auth' }, 'Register')),
      );
      $('#login-btn').onclick = async () => {
        const token = $('#token-input').value.trim();
        if (!token) return;
        saveToken(token);
        try {
          state.identity = await api('GET', '/identities/me');
          await loadDomains();
          render();
        } catch (e) {
          state.token = null; localStorage.removeItem('fuse_token');
          $('#auth-error').textContent = e.message;
          $('#auth-error').style.display = 'block';
        }
      };
    }
    $('#toggle-auth').onclick = (e) => { e.preventDefault(); mode.register = !mode.register; buildForm(); };
  }
  buildForm();
}

function renderApp(container) {
  container.innerHTML = '';
  const sidebar = el('div', { className: 'sidebar' },
    el('div', { className: 'sidebar-header' },
      el('h2', {}, 'FUSE'),
      el('button', { onclick: showCreateDomain }, '+'),
    ),
    el('div', { className: 'sidebar-nav', id: 'sidebar-nav' }),
    el('div', { className: 'sidebar-user' },
      el('strong', {}, state.identity?.displayName || state.identity?.handle),
      el('span', {}, `@${state.identity?.handle}`),
    ),
  );
  const main = el('div', { className: 'main', id: 'main-content' });
  container.append(sidebar, main);
  buildSidebarNav();
  renderPage();
}

function buildSidebarNav() {
  const nav = $('#sidebar-nav');
  nav.innerHTML = '';
  nav.append(el('a', { href: '#', className: 'active', id: 'nav-dashboard' }, 'Dashboard'));
  const domainIds = new Set();
  state.domains.forEach(d => domainIds.add(d.id));
  if (state.domains.length > 0) {
    nav.append(el('div', { style: { padding: '12px 12px 4px', fontSize: '11px', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Channels'));
    state.channels.forEach(ch => {
      nav.append(el('a', { href: '#', 'data-channel-id': ch.id, onclick: () => selectChannel(ch.id) }, `# ${ch.name}`));
    });
  }
}

function renderPage() {
  const main = $('#main-content');
  if (!main) return;
  if (state.currentChannelId) { renderChannelView(main); return; }
  renderDashboard(main);
}

function selectChannel(channelId) {
  state.currentChannelId = channelId;
  state.currentDomainId = null;
  render();
  render();
}

function renderDashboard(main) {
  main.innerHTML = '';
  const header = el('div', { className: 'page-header' },
    el('h1', {}, 'Dashboard'),
    el('div', { style: { display: 'flex', gap: '8px' } },
      el('button', { onclick: showCreateDomain }, 'New Domain'),
      state.currentDomainId ? el('button', { onclick: showCreateChannel }, 'New Channel') : null,
    ),
  );
  main.append(header);

  const content = el('div', { className: 'page-content' });
  main.append(content);

  if (state.domains.length === 0) {
    content.append(el('div', { className: 'empty-state' }, el('p', {}, 'No domains yet.'), el('button', { onclick: showCreateDomain }, 'Create a Domain')));
    return;
  }

  const domainNav = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' } });
  state.domains.forEach(d => {
    const btn = el('button', {
      className: state.currentDomainId === d.id ? 'primary' : '',
      onclick: async () => { state.currentDomainId = d.id; state.currentChannelId = null; await loadChannels(); render(); }
    }, d.name);
    domainNav.append(btn);
  });
  content.append(domainNav);

  const currentDomain = state.domains.find(d => d.id === state.currentDomainId);
  if (!currentDomain) return;

  const card = el('div', { className: 'card' },
    el('div', { className: 'card-header' },
      el('h2', {}, currentDomain.name),
      el('span', { style: { color: 'var(--text2)', fontSize: '12px' } }, `trust: ${currentDomain.trustLevel} · verified: ${currentDomain.verified}`),
    ),
    el('p', { style: { color: 'var(--text2)', fontSize: '13px', marginBottom: '12px' } }, `Contact: ${currentDomain.contactEmail}`),
  );
  content.append(card);

  if (state.channels.length === 0) {
    content.append(el('div', { className: 'empty-state' }, el('p', {}, 'No channels in this domain.'), el('button', { onclick: showCreateChannel }, 'Create Channel')));
    return;
  }

  const table = el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Type'), el('th', {}, 'SMTP Address'), el('th', {}, 'Created'), el('th', {}, ''))),
    el('tbody', {}, ...state.channels.map(ch =>
      el('tr', {},
        el('td', {}, el('strong', {}, ch.name)),
        el('td', {}, el('span', { className: `badge badge-${ch.type}` }, ch.type)),
        el('td', { style: { fontFamily: 'monospace', fontSize: '12px' } }, ch.smtpAddress),
        el('td', { style: { color: 'var(--text2)', fontSize: '12px' } }, new Date(ch.createdAt).toLocaleDateString()),
        el('td', {}, el('button', { onclick: () => selectChannel(ch.id) }, 'Open')),
      )
    )),
  );
  content.append(table);
}

function renderChannelView(main) {
  main.innerHTML = '';
  const channel = state.channels.find(c => c.id === state.currentChannelId);
  const header = el('div', { className: 'page-header' },
    el('div', {},
      el('h1', { style: { marginBottom: '2px' } }, `# ${channel?.name || 'Channel'}`),
      el('span', { style: { color: 'var(--text2)', fontSize: '12px' } }, channel?.smtpAddress || ''),
    ),
    el('button', { onclick: () => { state.currentChannelId = null; render(); } }, 'Back'),
  );
  main.append(header);

  const view = el('div', { className: 'channel-view' });
  main.append(view);

  const messagesEl = el('div', { className: 'channel-messages', id: 'channel-messages' });
  view.append(messagesEl);

  const inputArea = el('div', { className: 'message-input' },
    el('input', { id: 'msg-input', type: 'text', placeholder: `Message #${channel?.name || ''}...` }),
    el('button', { className: 'primary', id: 'msg-send-btn' }, 'Send'),
  );
  view.append(inputArea);

  async function sendMessage() {
    const input = $('#msg-input');
    const body = input.value.trim();
    if (!body || !state.currentChannelId) return;
    input.value = '';
    try {
      await api('POST', `/channels/${state.currentChannelId}/messages`, { body });
      await loadMessages();
      renderMessages(messagesEl);
    } catch (e) { console.error('send error:', e); }
  }

  $('#msg-send-btn').onclick = sendMessage;
  $('#msg-input').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  renderMessages(messagesEl);
}

async function renderMessages(container) {
  await loadMessages();
  container.innerHTML = '';
  if (state.messages.length === 0) {
    container.append(el('div', { className: 'empty-state' }, el('p', {}, 'No messages yet. Send one!')));
    return;
  }
  container.innerHTML = '';
  state.messages.forEach(m => {
    const msgEl = el('div', { className: 'message' },
      el('span', { className: 'author' }, m.authorId?.slice(0, 8) || 'unknown'),
      el('span', { className: 'time' }, new Date(m.createdAt).toLocaleTimeString()),
      el('div', { className: 'body' }, m.body),
    );
    container.append(msgEl);
  });
  container.scrollTop = container.scrollHeight;
}

async function showCreateDomain() {
  const modal = el('div', { className: 'modal-overlay', id: 'modal' },
    el('div', { className: 'modal' },
      el('h2', {}, 'New Domain'),
      el('div', { className: 'form-group' }, el('label', {}, 'Domain Name'), el('input', { id: 'new-domain-name', placeholder: 'example.com' })),
      el('div', { className: 'form-group' }, el('label', {}, 'Contact Email'), el('input', { id: 'new-domain-email', placeholder: 'admin@example.com', value: 'admin@fuse.ffilt.us' })),
      el('div', { className: 'modal-actions' },
        el('button', { onclick: closeModal }, 'Cancel'),
        el('button', { className: 'primary', id: 'create-domain-btn' }, 'Create'),
      ),
    ),
  );
  document.body.append(modal);
  $('#create-domain-btn').onclick = async () => {
    const name = $('#new-domain-name').value.trim();
    const contactEmail = $('#new-domain-email').value.trim();
    if (!name || !contactEmail) return;
    try {
      await api('POST', '/domains', { name, contactEmail });
      closeModal();
      await loadDomains();
      render();
    } catch (e) { alert(e.message); }
  };
}

async function showCreateChannel() {
  if (!state.currentDomainId) return;
  const modal = el('div', { className: 'modal-overlay', id: 'modal' },
    el('div', { className: 'modal' },
      el('h2', {}, 'New Channel'),
      el('div', { className: 'form-group' }, el('label', {}, 'Channel Name'), el('input', { id: 'new-channel-name', placeholder: 'general' })),
      el('div', { className: 'form-group' },
        el('label', {}, 'Type'),
        el('select', { id: 'new-channel-type' },
          el('option', { value: 'public' }, 'Public'),
          el('option', { value: 'private' }, 'Private'),
          el('option', { value: 'dm' }, 'Direct Message'),
          el('option', { value: 'group' }, 'Group'),
        ),
      ),
      el('div', { className: 'modal-actions' },
        el('button', { onclick: closeModal }, 'Cancel'),
        el('button', { className: 'primary', id: 'create-channel-btn' }, 'Create'),
      ),
    ),
  );
  document.body.append(modal);
  $('#create-channel-btn').onclick = async () => {
    const name = $('#new-channel-name').value.trim();
    const type = $('#new-channel-type').value;
    if (!name) return;
    try {
      await api('POST', '/channels', { name, type, domainId: state.currentDomainId });
      closeModal();
      await loadChannels();
      render();
    } catch (e) { alert(e.message); }
  };
}

function closeModal() {
  const m = $('#modal');
  if (m) m.remove();
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) closeModal();
});

init();
