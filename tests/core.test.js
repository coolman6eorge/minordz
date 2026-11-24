'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = require('../app.js');

const ROOT = path.resolve(__dirname, '..');
const DENIS = path.join(ROOT, 'denis_cybersecurity');
const VALID_DIR = path.join(DENIS, 'manifests');
const INVALID_DIR = path.join(DENIS, 'invalid');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validManifest(name) {
  const parsed = app.parseManifestText(
    fs.readFileSync(path.join(VALID_DIR, name), 'utf8'),
    name
  );
  assert.equal(parsed.ok, true, `Ожидался корректный файл ${name}`);
  return parsed.manifest;
}

function compareNames(oldName, newName) {
  return app.compareManifests(
    validManifest(oldName),
    validManifest(newName),
    oldName,
    newName
  );
}

test('Демонстрационная пара team-assistant даёт ровно drive.files.read и mail.send', () => {
  const oldManifest = readJson(path.join(ROOT, 'manifest_old.json'));
  const newManifest = readJson(path.join(ROOT, 'manifest_new.json'));
  const oldParsed = app.validateManifestObject(oldManifest, 'manifest_old.json');
  const newParsed = app.validateManifestObject(newManifest, 'manifest_new.json');

  assert.equal(oldParsed.ok, true);
  assert.equal(newParsed.ok, true);

  const result = app.compareManifests(
    oldParsed.manifest,
    newParsed.manifest,
    'manifest_old.json',
    'manifest_new.json'
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.request.newRights, ['drive.files.read', 'mail.send']);
  assert.equal(result.request.newRights.includes('profile.read'), false);
  assert.deepEqual(result.request.removedRights, []);
});

test('Все 15 корректных файлов Дениса проходят проверку', () => {
  const files = fs.readdirSync(VALID_DIR).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 15);

  for (const file of files) {
    const parsed = app.parseManifestText(
      fs.readFileSync(path.join(VALID_DIR, file), 'utf8'),
      file
    );
    assert.equal(parsed.ok, true, `${file}: ${JSON.stringify(parsed.errors)}`);
    assert.equal(typeof parsed.manifest.plugin_id, 'string');
    assert.equal(typeof parsed.manifest.version, 'string');
    assert.equal(Array.isArray(parsed.manifest.permissions), true);
  }
});

test('Все 6 намеренно некорректных файлов отклоняются с понятной ошибкой', () => {
  const files = fs.readdirSync(INVALID_DIR).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 6);

  for (const file of files) {
    const parsed = app.parseManifestText(
      fs.readFileSync(path.join(INVALID_DIR, file), 'utf8'),
      file
    );
    assert.equal(parsed.ok, false, `${file} не должен проходить проверку`);
    assert.ok(parsed.errors.length > 0);
    for (const error of parsed.errors) {
      assert.equal(error.fileName, file);
      assert.ok(error.field);
      assert.ok(error.message);
      assert.ok(error.action);
    }
  }
});

test('Точные ожидаемые новые права для пар T01–T22', () => {
  const pairs = [
    ['T01', '01_current_v1.0.0.json', '03_update_v1.0.1_no_change.json', []],
    ['T02', '01_current_v1.0.0.json', '02_update_v1.1.0_add_write.json', ['documents.write']],
    ['T05', '01_current_v1.0.0.json', '04_update_v1.2.0_same_rights.json', ['documents.write']],
    ['T08', '06_current_v1.1.0_read_write.json', '08_update_v1.2.1_replace_write.json', ['documents.export']],
    ['T09', '01_current_v1.0.0.json', '07_update_v1.3.0_two_added.json', ['documents.write', 'documents.export']],
    ['T10', '06_current_v1.1.0_read_write.json', '11_update_v1.2.3_remove_write.json', []],
    ['T11', '06_current_v1.1.0_read_write.json', '09_update_v1.2.2_reordered.json', []],
    ['T12', '01_current_v1.0.0.json', '10_update_v1.0.2_duplicates.json', []],
    ['T13', '01_current_v1.0.0.json', '12_update_v1.0.3_empty.json', []],
    ['T14', '05_current_v0.9.0_empty.json', '01_current_v1.0.0.json', ['documents.read']],
    ['T21', '01_current_v1.0.0.json', '13_update_v1.4.0_unknown.json', ['calendar.share']],
    ['T22', '06_current_v1.1.0_read_write.json', '04_update_v1.2.0_same_rights.json', []]
  ];

  for (const [id, oldName, newName, expected] of pairs) {
    const result = compareNames(oldName, newName);
    assert.equal(result.ok, true, id);
    assert.deepEqual(result.request.newRights, expected, id);
  }
});

test('Разные плагины не сравниваются', () => {
  const result = compareNames(
    '01_current_v1.0.0.json',
    '15_other_plugin_v1.1.0.json'
  );
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Нельзя сравнить разные плагины/);
  assert.match(result.errors[0].message, /office-helper/);
  assert.match(result.errors[0].message, /calendar-helper/);
});

test('Одинаковые версии отклоняются, версии не сравниваются как числа', () => {
  const oldManifest = {
    plugin_id: 'office-helper',
    version: '1.0.0',
    permissions: ['documents.read']
  };
  const newManifest = {
    plugin_id: 'office-helper',
    version: '1.0.0',
    permissions: ['documents.read', 'documents.write']
  };
  const result = app.compareManifests(oldManifest, newManifest, 'old.json', 'new.json');
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Версии должны различаться/);
});

test('Порядок, дубли и регистр обрабатываются по правилам множеств', () => {
  const base = {
    plugin_id: 'test-plugin',
    version: '1.0',
    permissions: ['b.read', 'a.read', 'a.read']
  };
  const candidate = {
    plugin_id: 'test-plugin',
    version: '1.1',
    permissions: ['a.read', 'c.read', 'c.read', 'A.read']
  };
  const result = app.compareManifests(base, candidate, 'base', 'candidate');
  assert.equal(result.ok, true);
  assert.deepEqual(result.request.newRights, ['c.read', 'A.read']);
  assert.deepEqual(result.request.removedRights, ['b.read']);
  assert.deepEqual(result.request.oldPermissions, ['a.read', 'b.read']);
  assert.deepEqual(result.request.newPermissions, ['A.read', 'a.read', 'c.read']);
});

test('Удаление не считается добавлением, замена при равной длине обнаруживается', () => {
  const result = compareNames(
    '06_current_v1.1.0_read_write.json',
    '08_update_v1.2.1_replace_write.json'
  );
  assert.deepEqual(result.request.newRights, ['documents.export']);
  assert.deepEqual(result.request.removedRights, ['documents.write']);
});

test('Ключ запроса стабилен при другом порядке и дублях, но меняется от содержимого', () => {
  const first = app.createRequestKey({
    pluginId: 'office-helper',
    oldVersion: '1.0.0',
    newVersion: '1.1.0',
    oldPermissions: ['documents.read'],
    newPermissions: ['documents.write', 'documents.read', 'documents.write']
  });
  const reordered = app.createRequestKey({
    pluginId: 'office-helper',
    oldVersion: '1.0.0',
    newVersion: '1.1.0',
    oldPermissions: ['documents.read'],
    newPermissions: ['documents.read', 'documents.write']
  });
  const changedContent = app.createRequestKey({
    pluginId: 'office-helper',
    oldVersion: '1.0.0',
    newVersion: '1.1.0',
    oldPermissions: ['documents.read'],
    newPermissions: ['documents.read', 'documents.write', 'documents.export']
  });
  const changedVersion = app.createRequestKey({
    pluginId: 'office-helper',
    oldVersion: '1.0.0',
    newVersion: '1.2.0',
    oldPermissions: ['documents.read'],
    newPermissions: ['documents.read', 'documents.write']
  });

  assert.equal(first, reordered);
  assert.notEqual(first, changedContent);
  assert.notEqual(first, changedVersion);
});

test('Проверка полей: типы, пустые значения, лишние поля, пустой массив', () => {
  const base = {
    plugin_id: 'office-helper',
    version: '1.0.0',
    permissions: []
  };

  assert.equal(app.validateManifestObject(base, 'ok.json').ok, true);
  assert.equal(app.validateManifestObject({ ...base, extra: true }, 'extra.json').ok, true);
  assert.equal(app.validateManifestObject([], 'array.json').ok, false);
  assert.equal(app.validateManifestObject(null, 'null.json').ok, false);
  assert.equal(app.validateManifestObject('text', 'string.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, plugin_id: 42 }, 'id-number.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, plugin_id: '  ' }, 'id-blank.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, plugin_id: ' x ' }, 'id-space.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, version: 1.1 }, 'version-number.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, version: ' ' }, 'version-blank.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, version: ' 1.1 ' }, 'version-space.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, permissions: 'a' }, 'permissions-string.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, permissions: [42] }, 'permission-number.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, permissions: [''] }, 'permission-blank.json').ok, false);
  assert.equal(app.validateManifestObject({ ...base, permissions: [' a'] }, 'permission-space.json').ok, false);

  const missingPermissions = {
    plugin_id: 'office-helper',
    version: '1.0.0'
  };
  const missing = app.validateManifestObject(missingPermissions, 'missing.json');
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0].message, /Отсутствует обязательное поле permissions/);
});

test('Некорректный JSON не раскрывает stack trace в пользовательском сообщении', () => {
  const parsed = app.parseManifestText('{"a": 1,}', 'broken.json');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors[0].field, 'JSON');
  assert.doesNotMatch(parsed.errors[0].message, /at JSON\.parse|SyntaxError/);
});

test('Словарь объяснений содержит обязательные права и честное неизвестное право', () => {
  for (const permission of [
    'profile.read',
    'drive.files.read',
    'mail.send',
    'documents.read',
    'documents.write',
    'documents.export',
    'calendar.share'
  ]) {
    const info = app.getPermissionInfo(permission);
    assert.ok(info.title);
    assert.ok(info.description);
  }

  assert.equal(app.getPermissionInfo('calendar.share').known, false);
  assert.equal(
    app.getPermissionInfo('calendar.share').description,
    'Назначение права неизвестно. Уточните доступные данные и действия у владельца плагина перед согласованием.'
  );

  const unknown = app.getPermissionInfo('future.unknown');
  assert.equal(unknown.known, false);
  assert.match(unknown.description, /Назначение права неизвестно/);
});

test('Запись журнала сохраняет снимки, роль, комментарий и часовой пояс', () => {
  const request = compareNames(
    '01_current_v1.0.0.json',
    '02_update_v1.1.0_add_write.json'
  ).request;
  const at = new Date('2026-11-24T13:05:07.000Z');
  const entry = app.createLogEntry(request, 'Согласовано', 'Согласующий · демо', '  Причина  ', at);

  assert.equal(entry.at, '2026-11-24T13:05:07.000Z');
  assert.equal(entry.pluginId, 'office-helper');
  assert.equal(entry.oldVersion, '1.0.0');
  assert.equal(entry.newVersion, '1.1.0');
  assert.deepEqual(entry.newRights, ['documents.write']);
  assert.equal(entry.comment, 'Причина');
  assert.equal(entry.role, 'Согласующий · демо');
  assert.deepEqual(entry.oldPermissions, ['documents.read']);
  assert.deepEqual(entry.newPermissions, ['documents.read', 'documents.write']);
  assert.match(app.formatOffset(at), /^UTC[+-]\d{2}:\d{2}$/);
});

test('Лимит размера файла равен 1 МБ', () => {
  assert.equal(app.MAX_FILE_BYTES, 1024 * 1024);
});
