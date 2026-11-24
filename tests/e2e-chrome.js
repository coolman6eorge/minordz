'use strict';

/**
 * Реальный браузерный прогон T01–T24 и сценария команды.
 * Зависимостей нет: используется Chrome DevTools Protocol и встроенный WebSocket Node.js.
 *
 * Запуск: node tests/e2e-chrome.js
 * Переменные: CHROME_PATH, TEAM33_KEEP_BROWSER=1
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTTP_PORT = 8766;
const DEBUG_PORT = 9334;
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}/`;
const ARTIFACTS = path.join(__dirname, 'artifacts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));

if (!chromePath) {
  console.error('BLOCKED: Chrome/Chromium не найден. Укажите путь в CHROME_PATH.');
  process.exit(2);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 40, label = 'условие') {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Истекло ожидание: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

async function waitForHttp(url, timeoutMs = 8000) {
  await waitFor(async () => {
    try {
      const response = await fetch(url);
      return response.ok;
    } catch {
      return false;
    }
  }, timeoutMs, 80, `HTTP ${url}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code})`));
        } else {
          resolve(message.result);
        }
        return;
      }

      if (message.method && this.listeners.has(message.method)) {
        for (const listener of this.listeners.get(message.method)) {
          listener(message.params);
        }
      }
    });

    socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('Соединение с Chrome закрыто'));
      }
      this.pending.clear();
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Таймаут WebSocket Chrome')), 5000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Ошибка WebSocket Chrome'));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // соединение уже закрыто
    }
  }
}

async function connectToPage() {
  await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('Chrome не создал page target');
  return CdpClient.connect(page.webSocketDebuggerUrl);
}

function createHarness(cdp) {
  const exceptions = [];

  cdp.on('Runtime.exceptionThrown', (event) => {
    exceptions.push(event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Unknown exception');
  });
  cdp.on('Log.entryAdded', (event) => {
    if (event.entry && event.entry.level === 'error') {
      const text = event.entry.text || '';
      if (!text.includes('favicon')) exceptions.push(text);
    }
  });

  async function evaluate(expression) {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        'Ошибка выполнения JavaScript в странице'
      );
    }
    return response.result.value;
  }

  async function text(selector) {
    return evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      return element ? element.textContent : '';
    })()`);
  }

  async function texts(selector) {
    return evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].map((element) => element.textContent)`);
  }

  async function isDisabled(id) {
    return evaluate(`document.getElementById(${JSON.stringify(id)}).disabled`);
  }

  async function click(id) {
    return evaluate(`(() => {
      const element = document.getElementById(${JSON.stringify(id)});
      if (!element) throw new Error('Нет элемента ' + ${JSON.stringify(id)});
      element.click();
      return true;
    })()`);
  }

  async function fillComment(value) {
    return evaluate(`(() => {
      const element = document.getElementById('comment');
      element.value = ${JSON.stringify(value)};
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return element.value;
    })()`);
  }

  async function setRole(role) {
    return evaluate(`(() => {
      const element = document.getElementById('role-select');
      element.value = ${JSON.stringify(role)};
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value;
    })()`);
  }

  async function upload(side, fileName) {
    const inputId = side === 'old' ? 'old-file' : 'new-file';
    const metaId = side === 'old' ? 'old-meta' : 'new-meta';
    const filePath = path.join(ROOT, 'denis_cybersecurity', 'manifests', fileName);

    if (!fs.existsSync(filePath)) throw new Error(`Нет файла ${filePath}`);

    const response = await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById(${JSON.stringify(inputId)})`,
      objectGroup: 'e2e-upload'
    });
    const objectId = response.result && response.result.objectId;
    if (!objectId) throw new Error(`Не найден input ${inputId}`);

    await cdp.send('DOM.setFileInputFiles', {
      files: [filePath],
      objectId
    });
    await cdp.send('Runtime.releaseObject', { objectId });

    await waitFor(async () => {
      const meta = await text(`#${metaId}`);
      return meta.includes(path.basename(filePath)) && !meta.includes('чтение');
    }, 5000, 40, `чтение ${fileName}`);
  }

  async function uploadAbsolute(side, filePath) {
    const inputId = side === 'old' ? 'old-file' : 'new-file';
    const metaId = side === 'old' ? 'old-meta' : 'new-meta';

    const response = await cdp.send('Runtime.evaluate', {
      expression: `document.getElementById(${JSON.stringify(inputId)})`,
      objectGroup: 'e2e-upload'
    });
    const objectId = response.result && response.result.objectId;
    if (!objectId) throw new Error(`Не найден input ${inputId}`);

    await cdp.send('DOM.setFileInputFiles', { files: [filePath], objectId });
    await cdp.send('Runtime.releaseObject', { objectId });
    await waitFor(async () => {
      const meta = await text(`#${metaId}`);
      return meta.includes(path.basename(filePath)) && !meta.includes('чтение');
    }, 5000, 40, `чтение ${path.basename(filePath)}`);
  }

  async function reset() {
    await click('reset-btn');
    await waitFor(async () => {
      const status = await text('#status-text');
      const title = await text('#rights-title');
      return status.includes('Загрузите оба манифеста') && title.includes('· 0');
    }, 2000, 20, 'сброс макета');
  }

  async function compare() {
    await click('compare-btn');
  }

  async function loadPair(oldName, newName, fixtureSet = 'manifests') {
    if (fixtureSet === 'invalid') {
      await upload('old', oldName);
      await uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', newName));
    } else {
      await upload('old', oldName);
      await upload('new', newName);
    }
  }

  async function submit(comment) {
    await fillComment(comment);
    await waitFor(async () => !(await isDisabled('submit-btn')), 2000, 20, 'активность передачи');
    await click('submit-btn');
  }

  async function approve(comment) {
    await setRole('approver');
    await fillComment(comment);
    await waitFor(async () => !(await isDisabled('approve-btn')), 2000, 20, 'активность согласования');
    await click('approve-btn');
  }

  async function reject(comment) {
    await setRole('approver');
    await fillComment(comment);
    await waitFor(async () => !(await isDisabled('reject-btn')), 2000, 20, 'активность отказа');
    await click('reject-btn');
  }

  async function logRows() {
    return evaluate(`[...document.querySelectorAll('#log-body tr.log-row')].map((row) => ({
      text: row.textContent,
      event: row.querySelector('.log-event') ? row.querySelector('.log-event').textContent : '',
      rights: [...row.querySelectorAll('.log-right')].map((element) => element.textContent),
      time: row.querySelector('time') ? {
        text: row.querySelector('time').textContent,
        datetime: row.querySelector('time').dateTime,
        title: row.querySelector('time').title
      } : null
    }))`);
  }

  async function alertText() {
    return evaluate(`(() => {
      const status = document.getElementById('status-text');
      const errors = document.getElementById('status-errors');
      return (status ? status.textContent : '') + ' ' + (errors ? errors.textContent : '');
    })()`);
  }

  async function viewport(width, height, mobile = false) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height
    });
  }

  async function screenshot(filePath) {
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true
    });
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
  }

  async function reload() {
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(async () => {
      try {
        return await evaluate(`document.readyState === 'complete' && typeof window.Team33 === 'object'`);
      } catch {
        return false;
      }
    }, 8000, 60, 'перезагрузка страницы');
  }

  return {
    evaluate,
    text,
    texts,
    isDisabled,
    click,
    fillComment,
    setRole,
    upload,
    uploadAbsolute,
    reset,
    compare,
    loadPair,
    submit,
    approve,
    reject,
    logRows,
    alertText,
    viewport,
    screenshot,
    reload,
    exceptions
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(haystack, needle, label) {
  assert(
    String(haystack).includes(needle),
    `${label}: ожидалось вхождение «${needle}», получено «${haystack}»`
  );
}

function assertNotIncludes(haystack, needle, label) {
  assert(
    !String(haystack).includes(needle),
    `${label}: не ожидалось вхождение «${needle}», получено «${haystack}»`
  );
}

function assertArray(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${label}: ожидалось ${e}, получено ${a}`);
}

function normalize(textValue) {
  return String(textValue).replace(/\s+/g, ' ').trim();
}

async function main() {
  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'team33-chrome-'));
  let server;
  let chrome;
  let cdp;
  const results = [];

  try {
    server = spawn('python3', ['-m', 'http.server', String(HTTP_PORT), '--bind', '127.0.0.1'], {
      cwd: ROOT,
      stdio: 'ignore'
    });
    await waitForHttp(BASE_URL);

    chrome = spawn(chromePath, [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${chromeProfile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--window-size=1280,1100',
      'about:blank'
    ], { stdio: 'ignore' });

    cdp = await connectToPage();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Log.enable');
    const harness = createHarness(cdp);

    await harness.viewport(1280, 1100, false);
    await cdp.send('Page.navigate', { url: BASE_URL });
    await waitFor(async () => {
      return harness.evaluate(`document.readyState === 'complete' && typeof window.Team33 === 'object'`);
    }, 8000, 60, 'загрузка приложения');

    const browserVersion = (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((response) => response.json())).Browser;

    const testCase = async (id, title, body) => {
      const entry = { id, title, status: 'PASS', note: '', checkedAt: new Date().toISOString() };
      try {
        await body();
      } catch (error) {
        entry.status = 'FAIL';
        entry.note = error.stack || error.message;
        console.error(`FAIL ${id} ${title}: ${error.message}`);
      }
      results.push(entry);
      if (entry.status === 'PASS') console.log(`PASS ${id} ${title}`);
      await delay(30);
    };

    await testCase('T01', 'Права не изменились', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '03_update_v1.0.1_no_change.json');
      await harness.compare();
      const rights = await harness.texts('#rights-list .right-id');
      assertArray(rights, [], 'T01 новые права');
      assertIncludes(await harness.text('#rights-title'), 'Новые права · 0', 'T01 счётчик');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T01 статус');
      assertIncludes(await harness.text('#status-text'), 'не подтверждает безопасность', 'T01 оговорка');
      assert((await harness.logRows()).length === 0, 'T01 журнал должен быть пустым');
      assert(await harness.isDisabled('submit-btn'), 'T01 передача должна быть недоступна');
      assert(await harness.isDisabled('approve-btn'), 'T01 согласование должно быть недоступно');
      assert(await harness.isDisabled('reject-btn'), 'T01 отказ должен быть недоступен');
    });

    await testCase('T02', 'Добавилось право изменения документов', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.write'], 'T02 новые права');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование. Новых прав: 1.', 'T02 статус макета');
      assertIncludes(await harness.text('#rights-list'), 'Создание и изменение документов', 'T02 объяснение');
      assert((await harness.logRows()).length === 0, 'T02 журнал должен быть пустым');
      assert(await harness.isDisabled('approve-btn'), 'T02 согласующий не должен решать без заявки');
      assert(await harness.isDisabled('submit-btn'), 'T02 передача без комментария недоступна');
      assert(await harness.isDisabled('reject-btn'), 'T02 отказ без заявки недоступен');
    });

    await testCase('T03', 'Отказ по запросу (адаптировано: сотрудник → согласующий)', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      await harness.fillComment('Нужна проверка изменения документов');
      assert(!(await harness.isDisabled('submit-btn')), 'T03 передача должна стать доступной');
      await harness.click('submit-btn');
      assertIncludes(await harness.text('#status-text'), 'Ожидает согласования', 'T03 ожидание');
      assert((await harness.logRows()).length === 1, 'T03 после передачи должна быть одна запись');
      assert(await harness.isDisabled('approve-btn'), 'T03 сотрудник не может согласовать');
      assert(await harness.isDisabled('reject-btn'), 'T03 сотрудник не может отклонить');

      await harness.click('compare-btn');
      assertIncludes(await harness.text('#status-text'), 'Ожидает согласования', 'T03 повторное сравнение не должно сбрасывать заявку');
      assert((await harness.logRows()).length === 1, 'T03 повторное сравнение не должно дублировать заявку');
      assert(await harness.isDisabled('submit-btn'), 'T03 повторная передача после сравнения недоступна');

      const rejectComment = 'Отклонено: изменение документов не нужно для этой задачи';
      await harness.reject(rejectComment);
      assertIncludes(await harness.text('#status-text'), 'Новые права отклонены', 'T03 статус отказа');
      assertIncludes(await harness.text('#status-text'), 'Запросите версию с меньшим доступом', 'T03 совет');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'T03 в журнале должно быть две записи');
      assertIncludes(rows[1].text, 'office-helper', 'T03 plugin_id');
      assertIncludes(rows[1].text, '1.0.0 → 1.1.0', 'T03 версии');
      assertIncludes(rows[1].text, 'Отклонено', 'T03 событие');
      assertIncludes(rows[1].text, rejectComment, 'T03 комментарий');
      assertArray(rows[1].rights, ['documents.write'], 'T03 права');
      assert(await harness.isDisabled('approve-btn'), 'T03 повторное решение недоступно');
      assert(await harness.isDisabled('reject-btn'), 'T03 повторный отказ недоступен');
    });

    await testCase('T04', 'Согласование и запись в журнал (адаптировано: сотрудник → согласующий)', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      await harness.submit('Нужен доступ для подготовки документов');
      await harness.approve('Согласовано: доступ нужен для задачи');
      assertIncludes(await harness.text('#status-text'), 'Новые права согласованы', 'T04 статус');
      assertIncludes(await harness.text('#status-text'), 'Реальное обновление не выполнялось', 'T04 ограничение');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'T04 в журнале должно быть две записи');
      assertIncludes(rows[1].text, 'Согласовано', 'T04 событие');
      assertIncludes(rows[1].text, 'Согласующий · демо', 'T04 роль');
      assertIncludes(rows[1].text, 'office-helper', 'T04 plugin_id');
      assert(rows[1].time && rows[1].time.datetime, 'T04 время решения отсутствует');
      assert(/UTC[+-]\d{2}:\d{2}/.test(rows[1].time.text), 'T04 нет часового пояса в отображении');
      assert(/[+-]\d{2}:\d{2}$/.test(rows[1].time.title), 'T04 нет смещения в ISO-времени');
      assert(await harness.isDisabled('approve-btn'), 'T04 повторное согласование недоступно');

      await harness.click('compare-btn');
      assertIncludes(await harness.text('#status-text'), 'Новые права согласованы', 'T04 повторное сравнение не должно сбрасывать решение');
      assert((await harness.logRows()).length === 2, 'T04 повторное сравнение не должно дублировать запись');
      assert(await harness.isDisabled('approve-btn'), 'T04 после повторного сравнения решение остаётся недоступным');
    });

    await testCase('T05', 'Другая версия после согласования', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      await harness.submit('Согласовать 1.1.0');
      await harness.approve('Согласовано для 1.1.0');
      assert((await harness.logRows()).length === 2, 'T05 исходное согласование не записано');

      await harness.upload('new', '04_update_v1.2.0_same_rights.json');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'T05 комментарий переносится на нового кандидата');
      assert((await harness.evaluate(`document.getElementById('role-select').value`)) === 'employee', 'T05 роль не сброшена');
      assertIncludes(await harness.text('#status-text'), 'Оба манифеста загружены', 'T05 после замены файла');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.write'], 'T05 новые права для 1.2.0');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T05 требуется новое решение');
      assertNotIncludes(await harness.text('#status-text'), 'согласованы', 'T05 согласие не должно переноситься');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'T05 исторические записи не должны исчезнуть');
      assertIncludes(rows[0].text, '1.1.0', 'T05 старая запись относится к 1.1.0');
      assert(await harness.isDisabled('approve-btn'), 'T05 нельзя согласовать без новой заявки');
    });

    await testCase('T06', 'Некорректный синтаксис JSON', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '16_broken_json.json'));
      assert(await harness.isDisabled('compare-btn'), 'T06 сравнение должно быть недоступно');
      const alert = await harness.alertText();
      assertIncludes(alert, '16_broken_json.json', 'T06 имя файла');
      assertIncludes(alert, 'JSON', 'T06 поле');
      assertIncludes(alert, 'синтаксис', 'T06 объяснение');
      assertIncludes(alert, 'Что сделать', 'T06 действие');
      assertNotIncludes(alert, 'SyntaxError', 'T06 техническое имя ошибки');
      assertNotIncludes(alert, 'at JSON.parse', 'T06 stack trace');
      assert((await harness.logRows()).length === 0, 'T06 журнал должен быть пустым');
      assert(await harness.isDisabled('submit-btn'), 'T06 передача недоступна');
    });

    await testCase('T07', 'Манифесты разных плагинов', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '15_other_plugin_v1.1.0.json');
      await harness.compare();
      const alert = await harness.alertText();
      assertIncludes(alert, 'Нельзя сравнить разные плагины', 'T07 ошибка');
      assertIncludes(alert, 'office-helper', 'T07 первый плагин');
      assertIncludes(alert, 'calendar-helper', 'T07 второй плагин');
      assert((await harness.logRows()).length === 0, 'T07 журнал должен быть пустым');
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T07 новых прав быть не должно');
      assert(await harness.isDisabled('approve-btn'), 'T07 согласование недоступно');
    });

    await testCase('T08', 'Замена права при прежнем количестве разрешений', async () => {
      await harness.reset();
      await harness.loadPair('06_current_v1.1.0_read_write.json', '08_update_v1.2.1_replace_write.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.export'], 'T08 новое право');
      const removed = await harness.text('#removed-note');
      assertIncludes(removed, 'documents.write', 'T08 удалённое право отдельно');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T08 статус');
      assert((await harness.logRows()).length === 0, 'T08 журнал должен быть пустым');
    });

    await testCase('T09', 'Одновременно добавлены два права', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '07_update_v1.3.0_two_added.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.write', 'documents.export'], 'T09 новые права');
      assertNotIncludes((await harness.texts('#rights-list .right-id')).join(','), 'documents.read', 'T09 read не новое');
      assertIncludes(await harness.text('#status-text'), 'Новых прав: 2', 'T09 счётчик');
      assert((await harness.logRows()).length === 0, 'T09 журнал должен быть пустым');
    });

    await testCase('T10', 'Одно право удалено', async () => {
      await harness.reset();
      await harness.loadPair('06_current_v1.1.0_read_write.json', '11_update_v1.2.3_remove_write.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T10 новых прав нет');
      assertIncludes(await harness.text('#removed-note'), 'documents.write', 'T10 удаление отдельно');
      assertNotIncludes(await harness.text('#rights-list'), 'Новых прав: 1', 'T10 удаление не добавление');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T10 статус');
    });

    await testCase('T11', 'Изменился только порядок разрешений', async () => {
      await harness.reset();
      await harness.loadPair('06_current_v1.1.0_read_write.json', '09_update_v1.2.2_reordered.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T11 порядок не влияет');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T11 статус');
    });

    await testCase('T12', 'Повторяющееся право', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '10_update_v1.0.2_duplicates.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T12 дубль не новое право');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T12 статус');
    });

    await testCase('T13', 'Пустой список разрешений в кандидате', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '12_update_v1.0.3_empty.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T13 новых прав нет');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T13 пустой массив допустим');
      assertNotIncludes(await harness.alertText(), 'Отсутствует обязательное поле permissions', 'T13 пустой массив не ошибка');
    });

    await testCase('T14', 'Первое новое право после пустой базы', async () => {
      await harness.reset();
      await harness.loadPair('05_current_v0.9.0_empty.json', '01_current_v1.0.0.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.read'], 'T14 новое право');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T14 требуется решение');
      assert((await harness.logRows()).length === 0, 'T14 журнал должен быть пустым');
    });

    await testCase('T15', 'Отсутствует обязательное поле', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '17_missing_permissions.json'));
      assert(await harness.isDisabled('compare-btn'), 'T15 сравнение недоступно');
      const alert = await harness.alertText();
      assertIncludes(alert, '17_missing_permissions.json', 'T15 имя файла');
      assertIncludes(alert, 'Отсутствует обязательное поле permissions', 'T15 ошибка');
      assertIncludes(alert, 'Что сделать', 'T15 действие');
      assert((await harness.logRows()).length === 0, 'T15 журнал должен быть пустым');
    });

    await testCase('T16', 'permissions передан строкой вместо массива', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '18_permissions_not_array.json'));
      const alert = await harness.alertText();
      assertIncludes(alert, 'permissions должен быть массивом строк', 'T16 ошибка типа');
      assertIncludes(alert, '18_permissions_not_array.json', 'T16 имя файла');
      assert(await harness.isDisabled('compare-btn'), 'T16 сравнение недоступно');
      assert((await harness.logRows()).length === 0, 'T16 журнал должен быть пустым');
    });

    await testCase('T17', 'Число вместо названия права', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '19_permission_not_string.json'));
      const alert = await harness.alertText();
      assertIncludes(alert, 'Каждое разрешение должно быть непустой строкой', 'T17 ошибка');
      assertIncludes(alert, '19_permission_not_string.json', 'T17 имя файла');
      assert(await harness.isDisabled('approve-btn'), 'T17 решение недоступно');
    });

    await testCase('T18', 'Содержимое кандидата изменилось после согласования при том же номере версии', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      await harness.submit('Согласовать текущий набор');
      await harness.approve('Согласовано для версии 1.1.0');
      assert((await harness.logRows()).length === 2, 'T18 исходное согласование не записано');
      await harness.upload('new', '14_update_v1.1.0_changed_content.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['documents.write', 'documents.export'], 'T18 новые права изменены');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T18 требуется новое решение');
      assertNotIncludes(await harness.text('#status-text'), 'согласованы', 'T18 старое согласие не действует');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'T18 старая история должна сохраниться');
      assertArray(rows[0].rights, ['documents.write'], 'T18 старая запись не переписана');
      assertArray(rows[1].rights, ['documents.write'], 'T18 вторая старая запись не переписана');
      assert(await harness.isDisabled('approve-btn'), 'T18 нельзя решить без новой заявки');
    });

    await testCase('T19', 'Ошибка после предыдущего согласования', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json');
      await harness.compare();
      await harness.submit('Согласовать корректную пару');
      await harness.approve('Согласовано');
      assert((await harness.logRows()).length === 2, 'T19 исходное согласование не записано');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '16_broken_json.json'));
      assertIncludes(await harness.alertText(), '16_broken_json.json', 'T19 ошибка нового файла');
      assertIncludes(await harness.text('#status-text'), 'Ошибка', 'T19 статус ошибки');
      assert((await harness.logRows()).length === 2, 'T19 старая история должна сохраниться');
      assert(await harness.isDisabled('approve-btn'), 'T19 прежний допуск должен быть сброшен');
      assert(await harness.isDisabled('reject-btn'), 'T19 решение по ошибке недоступно');
      assert(await harness.isDisabled('compare-btn'), 'T19 сравнение по ошибке недоступно');
    });

    await testCase('T20', 'Загружен только один файл', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      assertIncludes(await harness.text('#status-text'), 'Загрузите оба манифеста', 'T20 подсказка');
      assert(await harness.isDisabled('compare-btn'), 'T20 сравнение недоступно');
      assert(await harness.isDisabled('submit-btn'), 'T20 передача недоступна');
      assert(await harness.isDisabled('approve-btn'), 'T20 решение недоступно');
      assert((await harness.logRows()).length === 0, 'T20 журнал должен быть пустым');
    });

    await testCase('T21', 'Неизвестное интерфейсу разрешение calendar.share', async () => {
      await harness.reset();
      await harness.loadPair('01_current_v1.0.0.json', '13_update_v1.4.0_unknown.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), ['calendar.share'], 'T21 неизвестное право видно');
      assertIncludes(await harness.text('#rights-list'), 'Назначение права неизвестно. Уточните доступные данные и действия у владельца плагина перед согласованием.', 'T21 предупреждение');
      assertIncludes(await harness.text('#rights-list'), 'нет описания', 'T21 честная пометка');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T21 решение требуется');
      assert((await harness.logRows()).length === 0, 'T21 журнал должен быть пустым');
    });

    await testCase('T22', 'Сравнение с уже обновлённой текущей базой', async () => {
      await harness.reset();
      await harness.loadPair('06_current_v1.1.0_read_write.json', '04_update_v1.2.0_same_rights.json');
      await harness.compare();
      assertArray(await harness.texts('#rights-list .right-id'), [], 'T22 новых прав нет');
      assertIncludes(await harness.text('#status-text'), 'Новых прав не найдено', 'T22 статус');
      assertNotIncludes(await harness.text('#status-text'), 'Нужно согласование', 'T22 не требует решения');
      assert((await harness.logRows()).length === 0, 'T22 запись «согласовано» не создаётся');
    });

    await testCase('T23', 'Пустая версия', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '20_blank_version.json'));
      const alert = await harness.alertText();
      assertIncludes(alert, 'version должен быть непустой строкой без крайних пробелов', 'T23 ошибка');
      assertIncludes(alert, '20_blank_version.json', 'T23 имя файла');
      assert(await harness.isDisabled('compare-btn'), 'T23 сравнение недоступно');
    });

    await testCase('T24', 'Пустое название права', async () => {
      await harness.reset();
      await harness.upload('old', '01_current_v1.0.0.json');
      await harness.uploadAbsolute('new', path.join(ROOT, 'denis_cybersecurity', 'invalid', '21_empty_permission.json'));
      const alert = await harness.alertText();
      assertIncludes(alert, 'Каждое разрешение должно быть непустой строкой', 'T24 ошибка');
      assertIncludes(alert, '21_empty_permission.json', 'T24 имя файла');
      assert(await harness.isDisabled('compare-btn'), 'T24 сравнение недоступно');
    });

    const uiChecks = [];
    const uiCheck = async (name, body) => {
      const entry = { name, status: 'PASS', note: '' };
      try {
        await body();
      } catch (error) {
        entry.status = 'FAIL';
        entry.note = error.message;
        console.error(`FAIL UI ${name}: ${error.message}`);
      }
      uiChecks.push(entry);
      if (entry.status === 'PASS') console.log(`PASS UI ${name}`);
    };

    await uiCheck('Структура страницы и исходный дизайн загружены', async () => {
      assertIncludes(await harness.text('h1'), 'Сравнение прав плагина', 'заголовок');
      assertIncludes(await harness.text('.eyebrow'), 'Команда 33 · Проверка обновления', 'надпись команды');
      assertIncludes(await harness.text('.subtitle'), 'Сравните текущую и новую версии', 'описание');
      assertIncludes(await harness.text('.badge'), 'Интерактивный макет', 'метка макета');
      assertIncludes(await harness.text('.footer-note'), 'не заменяет авторизацию', 'нижняя оговорка');
      const cardStyle = await harness.evaluate(`(() => {
        const style = getComputedStyle(document.querySelector('.card'));
        return { radius: style.borderRadius, border: style.borderTopColor, bg: getComputedStyle(document.body).backgroundColor };
      })()`);
      assert(cardStyle.radius.startsWith('10px'), 'не применены скругления карточек');
      assert(cardStyle.bg !== 'rgba(0, 0, 0, 0)', 'не применён фон страницы');
      assert((await harness.texts('.log-table thead th')).length === 5, 'в журнале должно быть 5 колонок');
    });

    await uiCheck('Учебный пример: team-assistant и два новых права', async () => {
      await harness.reset();
      await harness.click('example-btn');
      await harness.evaluate(`document.getElementById('status-text').textContent`);
      assertIncludes(await harness.text('#old-meta'), 'manifest_old.json · версия 1.0', 'старый файл');
      assertIncludes(await harness.text('#new-meta'), 'manifest_new.json · версия 1.1', 'новый файл');
      assertArray(await harness.texts('#rights-list .right-id'), ['drive.files.read', 'mail.send'], 'демо-права');
      assertIncludes(await harness.text('#rights-title'), 'Новые права · 2', 'демо-счётчик');
      assertIncludes(await harness.text('#status-text'), 'Нужно согласование. Новых прав: 2. Решение ещё не принято.', 'демо-статус');
      assert((await harness.logRows()).length === 0, 'демо-журнал должен быть пустым');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'комментарий не должен быть заполнен');
      assert((await harness.evaluate(`document.getElementById('role-select').value`)) === 'employee', 'роль должна быть «Сотрудник»');
      assert(!(await harness.isDisabled('compare-btn')), 'кнопка сравнения должна оставаться доступной');
      const buttonOrder = await harness.texts('.upload-actions .btn');
      assertArray(buttonOrder, ['Сравнить права', 'Заполнить учебным примером', 'Сбросить макет'], 'порядок кнопок');
      const rightsText = await harness.text('#rights-list');
      assertIncludes(rightsText, 'Плагин сможет читать содержимое всех файлов, доступных подключённому аккаунту на рабочем диске. Изменение и удаление этим правом не разрешены.', 'объяснение чтения файлов');
      assertIncludes(rightsText, 'Плагин сможет отправлять письма с подключённого рабочего адреса. Чтение входящих писем этим правом не разрешено.', 'объяснение отправки писем');
      assertNotIncludes(rightsText, 'profile.read', 'profile.read не должен быть новым');
    });

    await uiCheck('Сценарий 2: сотрудник передаёт запрос и не может решить сам', async () => {
      const comment = 'Нужна проверка: отправка писем не требуется для поиска файлов';
      await harness.fillComment(comment);
      assert(!(await harness.isDisabled('submit-btn')), 'передача должна быть доступна с комментарием');
      await harness.click('submit-btn');
      assertIncludes(await harness.text('#status-text'), 'Ожидает согласования. Новые права ещё не согласованы.', 'статус ожидания');
      assert((await harness.logRows()).length === 1, 'после передачи должна быть одна запись');
      const row = (await harness.logRows())[0];
      assertIncludes(row.text, 'Передано на согласование', 'событие передачи');
      assertIncludes(row.text, 'Сотрудник', 'роль сотрудника');
      assertIncludes(row.text, comment, 'комментарий сотрудника');
      assertIncludes(row.text, 'team-assistant', 'plugin_id в журнале');
      assertIncludes(row.text, '1.0 → 1.1', 'версии в журнале');
      assertArray(row.rights, ['drive.files.read', 'mail.send'], 'права в журнале');
      assert(await harness.isDisabled('submit-btn'), 'повторная передача недоступна');
      assert(await harness.isDisabled('approve-btn'), 'сотрудник не может согласовать');
      assert(await harness.isDisabled('reject-btn'), 'сотрудник не может отклонить');
    });

    await uiCheck('Сценарий 3: смена роли, отказ, две записи журнала', async () => {
      const rejectComment = 'Отклонено: для поиска файлов не требуется отправка писем';
      await harness.reject(rejectComment);
      assertIncludes(await harness.text('#status-text'), 'Новые права отклонены. Отказ записан в журнале. Запросите версию с меньшим доступом.', 'статус отказа');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'в журнале должно быть две записи');
      assertIncludes(rows[0].text, 'Передано на согласование', 'первая запись');
      assertIncludes(rows[1].text, 'Отклонено', 'вторая запись');
      assertIncludes(rows[1].text, 'Согласующий · демо', 'роль согласующего');
      assertIncludes(rows[1].text, rejectComment, 'комментарий отказа');
      assert(await harness.isDisabled('reject-btn'), 'повторный отказ недоступен');
      assert(await harness.isDisabled('approve-btn'), 'согласование после отказа недоступно');
      assert(await harness.isDisabled('submit-btn'), 'передача после отказа недоступна');
      await harness.screenshot(path.join(ARTIFACTS, 'desktop-rejected.png'));
    });

    await uiCheck('Сброс макета и повторный сценарий', async () => {
      await harness.reset();
      assertIncludes(await harness.text('#status-text'), 'Загрузите оба манифеста', 'статус после сброса');
      assertIncludes(await harness.text('#rights-title'), 'Новые права · 0', 'права после сброса');
      assert((await harness.logRows()).length === 0, 'журнал после сброса должен быть пустым');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'комментарий после сброса');
      assertIncludes(await harness.text('#old-meta'), 'Файл не выбран', 'поле старого файла после сброса');
      assertIncludes(await harness.text('#new-meta'), 'Файл не выбран', 'поле нового файла после сброса');
      assert(await harness.isDisabled('compare-btn'), 'сравнение после сброса недоступно');
      await harness.click('example-btn');
      assertArray(await harness.texts('#rights-list .right-id'), ['drive.files.read', 'mail.send'], 'повторный пример');
    });

    await uiCheck('Альтернативная ветка согласования', async () => {
      await harness.submit('Передаю на согласование для проверки');
      await harness.approve('Согласовано: право необходимо для задачи');
      assertIncludes(await harness.text('#status-text'), 'Новые права согласованы. Реальное обновление не выполнялось.', 'статус согласования');
      const rows = await harness.logRows();
      assert(rows.length === 2, 'в журнале должно быть две записи');
      assertIncludes(rows[1].text, 'Согласовано', 'событие согласования');
      assert(await harness.isDisabled('approve-btn'), 'повторное согласование недоступно');
    });

    await uiCheck('Комментарий не переносится при новом сравнении', async () => {
      await harness.fillComment('Старый комментарий');
      await harness.upload('new', '01_current_v1.0.0.json');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'комментарий переносится при замене файла');
      assert((await harness.evaluate(`document.getElementById('role-select').value`)) === 'employee', 'роль не сброшена при замене файла');
      await harness.reset();
      await harness.fillComment('Комментарий перед примером');
      await harness.click('example-btn');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'комментарий переносится в учебный пример');
    });

    await uiCheck('Ручная загрузка manifest_old.json и manifest_new.json через File API', async () => {
      await harness.reset();
      await harness.uploadAbsolute('old', path.join(ROOT, 'manifest_old.json'));
      await harness.uploadAbsolute('new', path.join(ROOT, 'manifest_new.json'));
      assertIncludes(await harness.text('#old-meta'), 'manifest_old.json · версия 1.0', 'ручная загрузка старого файла');
      assertIncludes(await harness.text('#new-meta'), 'manifest_new.json · версия 1.1', 'ручная загрузка нового файла');
      assert(!(await harness.isDisabled('compare-btn')), 'сравнение должно быть доступно');
      await harness.compare();
      assertArray(
        await harness.texts('#rights-list .right-id'),
        ['drive.files.read', 'mail.send'],
        'результат ручной загрузки'
      );
      assertIncludes(await harness.text('#status-text'), 'Новых прав: 2', 'статус ручной загрузки');
    });

    await uiCheck('Файл больше 1 МБ отклоняется до сравнения', async () => {
      await harness.reset();
      const oversizePath = path.join(os.tmpdir(), 'team33-oversize.json');
      fs.writeFileSync(oversizePath, 'x'.repeat(1024 * 1024 + 1), 'utf8');
      try {
        await harness.uploadAbsolute('old', oversizePath);
        const alert = await harness.alertText();
        assertIncludes(alert, 'team33-oversize.json', 'имя большого файла');
        assertIncludes(alert, 'превышает 1 МБ', 'ошибка размера');
        assertIncludes(alert, 'Что сделать', 'действие при большом файле');
        assert(await harness.isDisabled('compare-btn'), 'сравнение с большим файлом недоступно');
        assert((await harness.logRows()).length === 0, 'журнал при ошибке размера должен быть пустым');
      } finally {
        fs.rmSync(oversizePath, { force: true });
      }
    });

    await uiCheck('Равные версии в паре отклоняются без сравнения прав', async () => {
      await harness.reset();
      await harness.loadPair('02_update_v1.1.0_add_write.json', '14_update_v1.1.0_changed_content.json');
      await harness.compare();
      const alert = await harness.alertText();
      assertIncludes(alert, 'Версии должны различаться', 'ошибка равенства версий');
      assertIncludes(alert, '1.1.0', 'версии в сообщении');
      assertArray(await harness.texts('#rights-list .right-id'), [], 'права при ошибке версий');
      assert((await harness.logRows()).length === 0, 'журнал при ошибке версий должен быть пустым');
    });

    await uiCheck('После перезагрузки журнал и состояние исчезают (in-memory)', async () => {
      await harness.reset();
      await harness.click('example-btn');
      await harness.submit('Проверка исчезновения журнала после перезагрузки');
      assert((await harness.logRows()).length === 1, 'перед перезагрузкой должна быть одна запись');
      await harness.reload();
      assert((await harness.logRows()).length === 0, 'после перезагрузки журнал должен быть пустым');
      assertIncludes(await harness.text('#status-text'), 'Загрузите оба манифеста', 'статус после перезагрузки');
      assertIncludes(await harness.text('#rights-title'), 'Новые права · 0', 'права после перезагрузки');
      assertIncludes(await harness.text('#old-meta'), 'Файл не выбран', 'старый файл после перезагрузки');
      assert((await harness.evaluate(`document.getElementById('comment').value`)) === '', 'комментарий после перезагрузки');
    });

    await uiCheck('Мобильная ширина 390 px без горизонтального переполнения страницы', async () => {
      await harness.viewport(390, 844, true);
      await delay(150);
      const layout = await harness.evaluate(`({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        gridColumns: getComputedStyle(document.querySelector('.upload-grid')).gridTemplateColumns,
        tableWrapperOverflow: getComputedStyle(document.querySelector('.table-wrap')).overflowX
      })`);
      assert(layout.innerWidth === 390, `неожиданная ширина viewport: ${layout.innerWidth}`);
      assert(layout.scrollWidth <= layout.innerWidth + 1, `горизонтальное переполнение: ${layout.scrollWidth} > ${layout.innerWidth}`);
      assert(layout.gridColumns.split(' ').length === 1, 'колонки загрузки не сложились в одну');
      assert(layout.tableWrapperOverflow === 'auto', 'таблица журнала не имеет собственной прокрутки');
    });

    await harness.viewport(1280, 1100, false);
    await harness.reset();
    await harness.click('example-btn');
    await delay(250);
    await harness.screenshot(path.join(ARTIFACTS, 'desktop-example.png'));

    await harness.viewport(390, 844, true);
    await delay(150);
    await harness.screenshot(path.join(ARTIFACTS, 'mobile-example.png'));

    const pageErrors = harness.exceptions;
    if (pageErrors.length > 0) {
      results.push({
        id: 'BROWSER',
        title: 'Ошибки JavaScript в консоли',
        status: 'FAIL',
        note: pageErrors.join('\n'),
        checkedAt: new Date().toISOString()
      });
    } else {
      results.push({
        id: 'BROWSER',
        title: 'Ошибки JavaScript в консоли',
        status: 'PASS',
        note: 'Необработанных исключений нет',
        checkedAt: new Date().toISOString()
      });
    }

    const summary = {
      environment: {
        browser: browserVersion,
        platform: process.platform,
        date: new Date().toISOString(),
        baseUrl: BASE_URL
      },
      summary: {
        total: results.length,
        pass: results.filter((entry) => entry.status === 'PASS').length,
        fail: results.filter((entry) => entry.status === 'FAIL').length
      },
      tests: results,
      uiChecks
    };

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(
      path.join(__dirname, 'e2e-results.json'),
      JSON.stringify(summary, null, 2) + '\n',
      'utf8'
    );

    console.log('');
    console.log(`Итого: ${summary.summary.pass}/${summary.summary.total} PASS, ${summary.summary.fail} FAIL`);
    console.log(`Результаты: ${path.join(__dirname, 'e2e-results.json')}`);
    console.log(`Скриншоты: ${ARTIFACTS}`);

    if (summary.summary.fail > 0 || uiChecks.some((entry) => entry.status === 'FAIL')) {
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    if (chrome && !process.env.TEAM33_KEEP_BROWSER) {
      chrome.kill('SIGTERM');
      await delay(200);
    }
    if (server) server.kill('SIGTERM');
    if (!process.env.TEAM33_KEEP_BROWSER) {
      await delay(200);
      try {
        fs.rmSync(chromeProfile, { recursive: true, force: true });
      } catch {
        // Chrome может ещё держать отдельные файлы профиля — это не влияет на результат.
      }
    }
  }
}

main().catch((error) => {
  console.error('BLOCKED: браузерный прогон не завершён.');
  console.error(error.stack || error.message);
  process.exit(2);
});
