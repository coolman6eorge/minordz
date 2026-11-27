'use strict';

/* ------------------------------------------------------------------ *
 * Константы и учебный словарь разрешений
 * ------------------------------------------------------------------ */

const MAX_FILE_BYTES = 1024 * 1024;

const UNKNOWN_PERMISSION_TEXT =
  'Назначение права неизвестно. Уточните доступные данные и действия у владельца плагина перед согласованием.';

const PERMISSION_DICTIONARY = Object.freeze({
  'profile.read': Object.freeze({
    title: 'Чтение базовых данных профиля',
    description: 'Плагин сможет читать базовые данные подключённого профиля. Изменение профиля этим правом не разрешено.',
    known: true
  }),
  'drive.files.read': Object.freeze({
    title: 'Читать файлы рабочего диска',
    description: 'Плагин сможет читать содержимое всех файлов, доступных подключённому аккаунту на рабочем диске. Изменение и удаление этим правом не разрешены.',
    known: true
  }),
  'mail.send': Object.freeze({
    title: 'Отправлять письма от вашего имени',
    description: 'Плагин сможет отправлять письма с подключённого рабочего адреса. Чтение входящих писем этим правом не разрешено.',
    known: true
  }),
  'documents.read': Object.freeze({
    title: 'Чтение документов',
    description: 'Плагин сможет читать документы в доступной ему учебной области. Изменение документов этим правом не разрешено.',
    known: true
  }),
  'documents.write': Object.freeze({
    title: 'Создание и изменение документов',
    description: 'Плагин сможет создавать и изменять документы в доступной ему учебной области. Чтение документов этим правом отдельно не разрешается.',
    known: true
  }),
  'documents.export': Object.freeze({
    title: 'Формирование выгрузки документов',
    description: 'Плагин сможет сформировать выгрузку или копию документов. Само по себе это право не доказывает отправку данных третьему лицу.',
    known: true
  }),
  'calendar.share': Object.freeze({
    title: 'Неизвестное разрешение',
    description: UNKNOWN_PERMISSION_TEXT,
    known: false
  })
});

const DEMO = Object.freeze({
  old: Object.freeze({
    fileName: 'manifest_old.json',
    manifest: Object.freeze({
      plugin_id: 'team-assistant',
      version: '1.0',
      permissions: Object.freeze(['profile.read'])
    })
  }),
  new: Object.freeze({
    fileName: 'manifest_new.json',
    manifest: Object.freeze({
      plugin_id: 'team-assistant',
      version: '1.1',
      permissions: Object.freeze(['profile.read', 'drive.files.read', 'mail.send'])
    })
  })
});

/* ------------------------------------------------------------------ *
 * Чистые функции: проверка и сравнение
 * ------------------------------------------------------------------ */

function makeError(fileName, field, message, action) {
  return {
    fileName: fileName || 'манифест',
    field,
    message,
    action
  };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function describeJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'массив';
  switch (typeof value) {
    case 'string': return 'строка';
    case 'number': return 'число';
    case 'boolean': return 'логическое значение';
    case 'object': return 'объект';
    default: return typeof value;
  }
}

function validateManifestObject(data, fileName) {
  const file = fileName || 'манифест';
  const errors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    errors.push(makeError(
      file,
      'корень JSON',
      `Корневой элемент должен быть объектом, а получен ${describeJsonType(data)}.`,
      'Сделайте корнем JSON объект с полями plugin_id, version и permissions.'
    ));
    return { ok: false, errors };
  }

  if (!hasOwn(data, 'plugin_id')) {
    errors.push(makeError(
      file,
      'plugin_id',
      'Отсутствует обязательное поле plugin_id.',
      'Добавьте непустое строковое поле plugin_id с идентификатором плагина.'
    ));
  } else if (typeof data.plugin_id !== 'string') {
    errors.push(makeError(
      file,
      'plugin_id',
      `plugin_id должен быть строкой, а получено: ${describeJsonType(data.plugin_id)}.`,
      'Запишите идентификатор плагина в кавычках, например «team-assistant».'
    ));
  } else if (data.plugin_id.trim() === '') {
    errors.push(makeError(
      file,
      'plugin_id',
      'plugin_id должен быть непустой строкой.',
      'Укажите идентификатор плагина без пустых значений.'
    ));
  } else if (data.plugin_id !== data.plugin_id.trim()) {
    errors.push(makeError(
      file,
      'plugin_id',
      'plugin_id не должен содержать пробелы в начале или конце.',
      'Уберите лишние пробелы вокруг идентификатора плагина.'
    ));
  }

  if (!hasOwn(data, 'version')) {
    errors.push(makeError(
      file,
      'version',
      'Отсутствует обязательное поле version.',
      'Добавьте непустое строковое поле version, например «1.1.0».'
    ));
  } else if (typeof data.version !== 'string') {
    errors.push(makeError(
      file,
      'version',
      `version должен быть непустой строкой, а получено: ${describeJsonType(data.version)}.`,
      'Запишите версию в кавычках, например «1.1.0»; число автоматически не преобразуется.'
    ));
  } else if (data.version.trim() === '') {
    errors.push(makeError(
      file,
      'version',
      'version должен быть непустой строкой без крайних пробелов.',
      'Укажите версию, например «1.1.0», и не оставляйте строку пустой.'
    ));
  } else if (data.version !== data.version.trim()) {
    errors.push(makeError(
      file,
      'version',
      'version не должен содержать пробелы в начале или конце.',
      'Уберите лишние пробелы вокруг номера версии.'
    ));
  }

  if (!hasOwn(data, 'permissions')) {
    errors.push(makeError(
      file,
      'permissions',
      'Отсутствует обязательное поле permissions.',
      'Добавьте поле permissions — массив строк. Если прав нет, укажите [].'
    ));
  } else if (!Array.isArray(data.permissions)) {
    errors.push(makeError(
      file,
      'permissions',
      `permissions должен быть массивом строк, а получено: ${describeJsonType(data.permissions)}.`,
      'Оформите список прав как массив: ["documents.read"]. Строку нельзя сравнивать как массив.'
    ));
  } else {
    data.permissions.forEach((permission, index) => {
      if (typeof permission !== 'string') {
        errors.push(makeError(
          file,
          'permissions',
          `Каждое разрешение должно быть непустой строкой. Элемент permissions[${index}] имеет тип: ${describeJsonType(permission)}.`,
          'Запишите название разрешения строкой в кавычках; не заменяйте его числом или другим типом.'
        ));
      } else if (permission.trim() === '') {
        errors.push(makeError(
          file,
          'permissions',
          `Каждое разрешение должно быть непустой строкой. Элемент permissions[${index}] пустой.`,
          'Удалите пустую строку из массива permissions или укажите название разрешения.'
        ));
      } else if (permission !== permission.trim()) {
        errors.push(makeError(
          file,
          'permissions',
          `Название разрешения не должно содержать пробелы в начале или конце: permissions[${index}].`,
          'Уберите лишние пробелы вокруг названия разрешения.'
        ));
      }
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: {
      plugin_id: data.plugin_id,
      version: data.version,
      permissions: data.permissions.slice()
    },
    errors: []
  };
}

function parseManifestText(text, fileName) {
  const file = fileName || 'манифест';

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      ok: false,
      errors: [makeError(
        file,
        'JSON',
        'Файл пуст или не содержит текста JSON.',
        'Выберите непустой JSON-файл и повторите загрузку.'
      )]
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [makeError(
        file,
        'JSON',
        'Не удалось прочитать JSON: нарушен синтаксис.',
        'Проверьте запятые, кавычки и скобки, затем загрузите файл снова.'
      )]
    };
  }

  return validateManifestObject(data, file);
}

/**
 * Стабильный ключ запроса: plugin_id + обе версии + оба полных набора прав.
 * Порядок и повторы не влияют на ключ. Регистр и точное написание значимы.
 */
function createRequestKey({ pluginId, oldVersion, newVersion, oldPermissions, newPermissions }) {
  const canonical = JSON.stringify([
    pluginId,
    oldVersion,
    newVersion,
    Array.from(new Set(oldPermissions)).sort(),
    Array.from(new Set(newPermissions)).sort()
  ]);
  return `request-v1:${canonical}`;
}

function compareManifests(oldManifest, newManifest, oldFileName, newFileName) {
  const oldName = oldFileName || 'текущий манифест';
  const newName = newFileName || 'новый манифест';

  if (!oldManifest || !newManifest) {
    return {
      ok: false,
      errors: [makeError(
        `${oldName} / ${newName}`,
        'файлы',
        'Для сравнения нужны два корректных манифеста.',
        'Загрузите текущую и новую версии и повторите сравнение.'
      )]
    };
  }

  if (oldManifest.plugin_id !== newManifest.plugin_id) {
    return {
      ok: false,
      errors: [makeError(
        `Файлы ${oldName} и ${newName}`,
        'plugin_id',
        `Нельзя сравнить разные плагины: ${oldManifest.plugin_id} и ${newManifest.plugin_id}.`,
        'Загрузите текущую и новую версии одного и того же плагина.'
      )]
    };
  }

  if (oldManifest.version === newManifest.version) {
    return {
      ok: false,
      errors: [makeError(
        `Файлы ${oldName} и ${newName}`,
        'version',
        `Версии должны различаться, но в обоих файлах указана версия «${oldManifest.version}».`,
        'Выберите другую пару файлов или укажите в новой версии отдельный номер версии.'
      )]
    };
  }

  const oldPermissions = Array.from(new Set(oldManifest.permissions));
  const newPermissions = Array.from(new Set(newManifest.permissions));
  const oldSet = new Set(oldPermissions);
  const newSet = new Set(newPermissions);
  const newRights = newPermissions.filter((permission) => !oldSet.has(permission));
  const removedRights = oldPermissions.filter((permission) => !newSet.has(permission));

  const request = {
    pluginId: oldManifest.plugin_id,
    oldVersion: oldManifest.version,
    newVersion: newManifest.version,
    oldPermissions: oldPermissions.slice().sort(),
    newPermissions: newPermissions.slice().sort(),
    newRights,
    removedRights,
    oldFileName: oldName,
    newFileName: newName
  };

  request.requestKey = createRequestKey(request);
  return { ok: true, request, errors: [] };
}

function getPermissionInfo(permission) {
  if (hasOwn(PERMISSION_DICTIONARY, permission)) {
    return PERMISSION_DICTIONARY[permission];
  }
  return {
    title: 'Неизвестное разрешение',
    description: UNKNOWN_PERMISSION_TEXT,
    known: false
  };
}

function createLogEntry(request, action, role, comment, date = new Date()) {
  return {
    at: date.toISOString(),
    pluginId: request.pluginId,
    oldVersion: request.oldVersion,
    newVersion: request.newVersion,
    newRights: request.newRights.slice(),
    action,
    role,
    comment: (comment || '').trim(),
    oldPermissions: request.oldPermissions.slice(),
    newPermissions: request.newPermissions.slice(),
    requestKey: request.requestKey
  };
}

/* ------------------------------------------------------------------ *
 * Приложение
 * ------------------------------------------------------------------ */

function initApp() {
  const dom = {
    oldInput: document.getElementById('old-file'),
    newInput: document.getElementById('new-file'),
    oldMeta: document.getElementById('old-meta'),
    newMeta: document.getElementById('new-meta'),
    oldError: document.getElementById('old-error'),
    newError: document.getElementById('new-error'),
    oldZone: document.getElementById('old-zone'),
    newZone: document.getElementById('new-zone'),
    compareBtn: document.getElementById('compare-btn'),
    exampleBtn: document.getElementById('example-btn'),
    resetBtn: document.getElementById('reset-btn'),
    status: document.getElementById('status'),
    statusText: document.getElementById('status-text'),
    statusErrors: document.getElementById('status-errors'),
    rightsTitle: document.getElementById('rights-title'),
    rightsList: document.getElementById('rights-list'),
    removedNote: document.getElementById('removed-note'),
    roleSelect: document.getElementById('role-select'),
    comment: document.getElementById('comment'),
    submitBtn: document.getElementById('submit-btn'),
    approveBtn: document.getElementById('approve-btn'),
    rejectBtn: document.getElementById('reject-btn'),
    logBody: document.getElementById('log-body')
  };

  let nextLoadToken = 0;

  const state = {
    old: createEmptySide(),
    new: createEmptySide(),
    comparison: null,
    pairErrors: [],
    approval: { phase: 'none', requestKey: null },
    role: 'employee',
    comment: '',
    log: []
  };

  function createEmptySide() {
    return {
      manifest: null,
      fileName: null,
      source: null,
      errors: [],
      loading: false,
      token: 0
    };
  }

  function activeErrors() {
    return [
      ...state.old.errors,
      ...state.new.errors,
      ...state.pairErrors
    ];
  }

  function isWorkflowRequestIntact() {
    const comparison = state.comparison;
    if (!comparison || activeErrors().length > 0) return false;
    if (!state.old.manifest || !state.new.manifest) return false;

    const result = compareManifests(
      state.old.manifest,
      state.new.manifest,
      state.old.fileName,
      state.new.fileName
    );

    return result.ok && result.request.requestKey === comparison.requestKey;
  }

  function resetTransientState() {
    state.comparison = null;
    state.pairErrors = [];
    state.approval = { phase: 'none', requestKey: null };
    state.role = 'employee';
    state.comment = '';
    dom.roleSelect.value = 'employee';
    dom.comment.value = '';
  }

  function clearFileInputs() {
    dom.oldInput.value = '';
    dom.newInput.value = '';
  }

  function renderFileSide(side, metaElement, errorElement, zoneElement) {
    const current = state[side];
    metaElement.classList.remove('is-placeholder');
    errorElement.hidden = true;
    errorElement.textContent = '';
    zoneElement.classList.toggle('is-invalid', current.errors.length > 0);

    if (current.loading) {
      metaElement.textContent = `${current.fileName || 'Файл'} · чтение…`;
      return;
    }

    if (current.errors.length > 0) {
      metaElement.textContent = `${current.fileName || 'Файл'} · ошибка проверки`;
      errorElement.hidden = false;
      errorElement.textContent = 'Файл не прошёл проверку. Подробности — в уведомлении под блоком загрузки.';
      return;
    }

    if (current.manifest) {
      metaElement.textContent = `${current.fileName} · версия ${current.manifest.version}`;
      return;
    }

    metaElement.textContent = 'Файл не выбран · версия —';
    metaElement.classList.add('is-placeholder');
  }

  function renderStatus() {
    const errors = activeErrors();
    let type = 'idle';
    let text = 'Загрузите оба манифеста.';

    if (errors.length > 0) {
      type = 'error';
      text = 'Ошибка проверки данных. Исправьте ошибку и повторите сравнение.';
    } else if (state.comparison) {
      if (state.approval.phase === 'submitted') {
        type = 'warning';
        text = 'Ожидает согласования. Новые права ещё не согласованы.';
      } else if (state.approval.phase === 'approved') {
        type = 'success';
        text = 'Новые права согласованы. Реальное обновление не выполнялось.';
      } else if (state.approval.phase === 'rejected') {
        type = 'rejected';
        text = 'Новые права отклонены. Отказ записан в журнале. Запросите версию с меньшим доступом.';
      } else if (state.comparison.newRights.length === 0) {
        type = 'neutral';
        text = 'Новых прав не найдено. Это не подтверждает безопасность обновления.';
      } else {
        type = 'warning';
        text = `Нужно согласование. Новых прав: ${state.comparison.newRights.length}. Решение ещё не принято.`;
      }
    } else if (state.old.manifest && state.new.manifest) {
      text = 'Оба манифеста загружены. Нажмите «Сравнить права».';
    }

    dom.status.className = `status status-${type}`;
    dom.status.setAttribute('role', type === 'error' ? 'alert' : 'status');
    dom.statusText.textContent = text;

    dom.statusErrors.replaceChildren();
    if (errors.length === 0) {
      dom.statusErrors.hidden = true;
      return;
    }

    dom.statusErrors.hidden = false;
    errors.forEach((error) => {
      const item = document.createElement('li');
      const file = document.createElement('strong');
      file.className = 'error-file';
      file.textContent = error.fileName;
      item.append(file);
      item.append(document.createTextNode(' · поле '));

      const field = document.createElement('code');
      field.textContent = error.field;
      item.append(field);
      item.append(document.createTextNode(`: ${error.message}`));

      const action = document.createElement('span');
      action.className = 'error-action';
      action.textContent = `Что сделать: ${error.action}`;
      item.append(action);
      dom.statusErrors.append(item);
    });
  }

  function renderRights() {
    const rights = state.comparison ? state.comparison.newRights : [];
    dom.rightsTitle.textContent = `Новые права · ${rights.length}`;
    dom.rightsList.replaceChildren();
    dom.removedNote.hidden = true;
    dom.removedNote.textContent = '';

    if (!state.comparison) {
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder-text';
      placeholder.textContent = activeErrors().length > 0
        ? 'Список не сформирован: исправьте ошибку и повторите сравнение.'
        : 'После сравнения здесь появятся права, которых не было в текущей версии.';
      dom.rightsList.append(placeholder);
      return;
    }

    if (rights.length === 0) {
      const placeholder = document.createElement('p');
      placeholder.className = 'placeholder-text';
      placeholder.textContent = 'Новых прав не найдено.';
      dom.rightsList.append(placeholder);
    } else {
      rights.forEach((permission) => {
        const info = getPermissionInfo(permission);
        const item = document.createElement('article');
        item.className = 'right-item';

        const titleRow = document.createElement('div');
        titleRow.className = 'right-title-row';

        const title = document.createElement('h3');
        title.className = 'right-title';
        title.textContent = info.title;
        titleRow.append(title);

        if (!info.known) {
          const badge = document.createElement('span');
          badge.className = 'right-badge';
          badge.textContent = 'нет описания';
          titleRow.append(badge);
        }

        const description = document.createElement('p');
        description.className = info.known ? 'right-description' : 'right-description is-unknown';
        description.textContent = info.description;

        const identifier = document.createElement('code');
        identifier.className = 'right-id';
        identifier.textContent = permission;

        item.append(titleRow, description, identifier);
        dom.rightsList.append(item);
      });
    }

    if (state.comparison.removedRights.length > 0) {
      dom.removedNote.hidden = false;
      dom.removedNote.textContent =
        `Удалённые права: ${state.comparison.removedRights.join(', ')}. ` +
        'Удаление не является добавлением и не отменяет решение по новым правам.';
    }
  }

  function renderDecisionControls() {
    if (dom.roleSelect.value !== state.role) {
      dom.roleSelect.value = state.role;
    }

    const requestIntact = isWorkflowRequestIntact();
    const hasNewRights = Boolean(requestIntact && state.comparison && state.comparison.newRights.length > 0);
    const hasComment = state.comment.trim().length > 0;
    const phase = state.approval.phase;

    const canCompare = Boolean(state.old.manifest && state.new.manifest);
    dom.compareBtn.disabled = !canCompare;

    const canSubmit = hasNewRights && phase === 'none' && state.role === 'employee' && hasComment;
    const canDecide = hasNewRights && phase === 'submitted' && state.role === 'approver' && hasComment;

    dom.submitBtn.disabled = !canSubmit;
    dom.approveBtn.disabled = !canDecide;
    dom.rejectBtn.disabled = !canDecide;

    dom.submitBtn.title = hasNewRights && phase === 'none' && state.role === 'employee' && !hasComment
      ? 'Введите комментарий к решению'
      : '';
    const decideTitle = hasNewRights && phase === 'submitted' && !hasComment
      ? 'Введите комментарий к решению'
      : '';
    dom.approveBtn.title = decideTitle;
    dom.rejectBtn.title = decideTitle;
  }

  function renderLog() {
    dom.logBody.replaceChildren();

    if (state.log.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'empty-log';
      cell.colSpan = 5;
      cell.textContent = 'Пока нет записей';
      row.append(cell);
      dom.logBody.append(row);
      return;
    }

    state.log.forEach((entry) => {
      const row = document.createElement('tr');
      row.className = 'log-row';
      row.dataset.requestKey = entry.requestKey;

      const timeCell = document.createElement('td');
      const time = document.createElement('time');
      time.className = 'log-time';
      time.dateTime = entry.at;
      const date = new Date(entry.at);
      time.textContent = formatDate(date);
      time.title = toLocalIsoWithOffset(date);
      const timeDetail = document.createElement('span');
      timeDetail.className = 'log-detail';
      timeDetail.textContent = `${formatTime(date)} · ${formatOffset(date)}`;
      time.append(timeDetail);
      timeCell.append(time);

      const versionsCell = document.createElement('td');
      versionsCell.textContent = `${entry.oldVersion} → ${entry.newVersion}`;
      versionsCell.title =
        `Старые права: ${entry.oldPermissions.join(', ') || '—'}. ` +
        `Новые права: ${entry.newPermissions.join(', ') || '—'}.`;

      const roleCell = document.createElement('td');
      roleCell.textContent = entry.role;

      const eventCell = document.createElement('td');
      const eventName = document.createElement('span');
      eventName.className = 'log-event';
      eventName.textContent = entry.action;
      eventCell.append(eventName);
      if (entry.comment) {
        const comment = document.createElement('span');
        comment.className = 'log-detail';
        comment.textContent = `Комментарий: ${entry.comment}`;
        eventCell.append(comment);
      }
      const plugin = document.createElement('span');
      plugin.className = 'log-plugin';
      plugin.textContent = `plugin_id: ${entry.pluginId}`;
      eventCell.append(plugin);

      const rightsCell = document.createElement('td');
      if (entry.newRights.length === 0) {
        rightsCell.textContent = '—';
      } else {
        entry.newRights.forEach((permission) => {
          const right = document.createElement('span');
          right.className = 'log-right';
          right.textContent = permission;
          rightsCell.append(right);
        });
      }

      row.append(timeCell, versionsCell, roleCell, eventCell, rightsCell);
      dom.logBody.append(row);
    });
  }

  function render() {
    renderFileSide('old', dom.oldMeta, dom.oldError, dom.oldZone);
    renderFileSide('new', dom.newMeta, dom.newError, dom.newZone);
    renderStatus();
    renderRights();
    renderDecisionControls();
    renderLog();
  }

  function isCurrentFileLoad(side, token) {
    return state[side].token === token;
  }

  function setStatusErrorFromRead(side, fileName, error) {
    state[side].errors = [error];
    state[side].manifest = null;
    state[side].fileName = fileName;
    state[side].loading = false;
  }

  async function handleFile(side, file) {
    const current = state[side];
    const token = ++nextLoadToken;
    current.token = token;

    resetTransientState();
    current.errors = [];
    current.manifest = null;
    current.fileName = file.name;
    current.source = 'upload';
    current.loading = true;
    render();

    if (file.size > MAX_FILE_BYTES) {
      if (!isCurrentFileLoad(side, token)) return;
      setStatusErrorFromRead(side, file.name, makeError(
        file.name,
        'размер файла',
        'Размер файла превышает 1 МБ.',
        'Уменьшите файл до 1 МБ и загрузите его снова.'
      ));
      render();
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      if (!isCurrentFileLoad(side, token)) return;
      setStatusErrorFromRead(side, file.name, makeError(
        file.name,
        'файл',
        'Не удалось прочитать выбранный файл.',
        'Проверьте доступ к файлу и выберите его снова.'
      ));
      render();
      return;
    }

    if (!isCurrentFileLoad(side, token)) return;

    const live = state[side];
    const parsed = parseManifestText(text, file.name);
    live.loading = false;
    if (!parsed.ok) {
      live.errors = parsed.errors;
      live.manifest = null;
    } else {
      live.errors = [];
      live.manifest = parsed.manifest;
    }
    render();
  }

  function performComparison() {
    if (!state.old.manifest || !state.new.manifest) return;

    const result = compareManifests(
      state.old.manifest,
      state.new.manifest,
      state.old.fileName,
      state.new.fileName
    );

    if (!result.ok) {
      resetTransientState();
      state.pairErrors = result.errors;
      render();
      return;
    }

    const sameRequest = Boolean(
      state.comparison &&
      state.comparison.requestKey === result.request.requestKey
    );

    state.pairErrors = [];
    if (sameRequest) {
      // Повторное нажатие «Сравнить права» без изменения входных данных
      // не должно открывать повторную передачу или повторное решение.
      state.comparison = result.request;
    } else {
      resetTransientState();
      state.comparison = result.request;
    }
    render();
  }

  function loadExample() {
    const oldToken = ++nextLoadToken;
    const newToken = ++nextLoadToken;
    state.old = {
      manifest: {
        plugin_id: DEMO.old.manifest.plugin_id,
        version: DEMO.old.manifest.version,
        permissions: Array.from(DEMO.old.manifest.permissions)
      },
      fileName: DEMO.old.fileName,
      source: 'example',
      errors: [],
      loading: false,
      token: oldToken
    };
    state.new = {
      manifest: {
        plugin_id: DEMO.new.manifest.plugin_id,
        version: DEMO.new.manifest.version,
        permissions: Array.from(DEMO.new.manifest.permissions)
      },
      fileName: DEMO.new.fileName,
      source: 'example',
      errors: [],
      loading: false,
      token: newToken
    };
    state.pairErrors = [];
    clearFileInputs();
    resetTransientState();
    performComparison();
  }

  function resetAll() {
    state.old = createEmptySide();
    state.new = createEmptySide();
    state.old.token = ++nextLoadToken;
    state.new.token = ++nextLoadToken;
    state.log = [];
    state.pairErrors = [];
    resetTransientState();
    clearFileInputs();
    render();
  }

  function submitForApproval() {
    const request = state.comparison;
    if (!request || !isWorkflowRequestIntact() || request.newRights.length === 0) return;
    if (state.approval.phase !== 'none') return;
    if (state.role !== 'employee') return;
    const comment = state.comment.trim();
    if (!comment) return;

    state.comment = comment;
    dom.comment.value = comment;
    state.approval = {
      phase: 'submitted',
      requestKey: request.requestKey,
      submittedAt: new Date().toISOString()
    };
    state.log.push(createLogEntry(request, 'Передано на согласование', 'Сотрудник', comment));
    render();
  }

  function decide(decision) {
    const request = state.comparison;
    if (!request || !isWorkflowRequestIntact() || request.newRights.length === 0) return;
    if (state.approval.phase !== 'submitted') return;
    if (state.role !== 'approver') return;
    if (state.approval.requestKey !== request.requestKey) return;

    const comment = state.comment.trim();
    if (!comment) return;

    const approved = decision === 'approve';
    const action = approved ? 'Согласовано' : 'Отклонено';

    state.comment = comment;
    dom.comment.value = comment;
    state.approval = {
      ...state.approval,
      phase: approved ? 'approved' : 'rejected',
      decidedAt: new Date().toISOString()
    };
    state.log.push(createLogEntry(request, action, 'Согласующий · демо', comment));
    render();
  }

  dom.oldInput.addEventListener('change', () => {
    const file = dom.oldInput.files && dom.oldInput.files[0];
    if (file) handleFile('old', file);
  });

  dom.newInput.addEventListener('change', () => {
    const file = dom.newInput.files && dom.newInput.files[0];
    if (file) handleFile('new', file);
  });

  dom.compareBtn.addEventListener('click', performComparison);
  dom.exampleBtn.addEventListener('click', loadExample);
  dom.resetBtn.addEventListener('click', resetAll);
  dom.submitBtn.addEventListener('click', submitForApproval);
  dom.approveBtn.addEventListener('click', () => decide('approve'));
  dom.rejectBtn.addEventListener('click', () => decide('reject'));

  dom.roleSelect.addEventListener('change', () => {
    state.role = dom.roleSelect.value === 'approver' ? 'approver' : 'employee';
    renderDecisionControls();
  });

  dom.comment.addEventListener('input', () => {
    state.comment = dom.comment.value;
    renderDecisionControls();
  });

  render();
}

/* ------------------------------------------------------------------ *
 * Форматирование даты и экспорт
 * ------------------------------------------------------------------ */

function formatDate(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatTime(date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function formatOffset(date) {
  const totalMinutes = -date.getTimezoneOffset();
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(totalMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, '0');
  const minutes = String(absolute % 60).padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

function toLocalIsoWithOffset(date) {
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAX_FILE_BYTES,
    PERMISSION_DICTIONARY,
    UNKNOWN_PERMISSION_TEXT,
    DEMO,
    makeError,
    validateManifestObject,
    parseManifestText,
    compareManifests,
    createRequestKey,
    getPermissionInfo,
    createLogEntry,
    formatOffset
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.Team33 = {
    MAX_FILE_BYTES,
    PERMISSION_DICTIONARY,
    UNKNOWN_PERMISSION_TEXT,
    validateManifestObject,
    parseManifestText,
    compareManifests,
    createRequestKey,
    getPermissionInfo
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp, { once: true });
  } else {
    initApp();
  }
}
