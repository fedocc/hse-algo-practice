import assert from 'node:assert/strict';
import {allowedUrl, problemIdentity, terminalVerdict, freshRun} from './utils.js';
import {pageAction} from './page-adapter.js';

assert.equal(allowedUrl('https://official.contest.yandex.ru/contest/81172/problems/A/'), true);
assert.equal(allowedUrl('https://official.contest.yandex.ru.evil.test/contest/81172/problems/A/'), false);
assert.equal(allowedUrl('http://leetcode.com/problems/two-sum/'), false);
assert.equal(allowedUrl('https://example.org'), false);
assert.deepEqual(problemIdentity('https://official.contest.yandex.ru/contest/81172/problems/A/'), {source:'yandex',contestId:'81172',letter:'A',id:'yandex-81172-A'});
assert.equal(problemIdentity('https://leetcode.com/problems/two-sum/').slug, 'two-sum');
assert.equal(terminalVerdict('OK'), 'Accepted');
assert.equal(terminalVerdict('Wrong Answer'), 'Wrong Answer');
assert.equal(terminalVerdict('Running'), null);
assert.equal(terminalVerdict('In queue'), null);
assert.equal(terminalVerdict('Waiting'), null);
assert.equal(terminalVerdict('Awaiting judgment'), null);
assert.equal(freshRun([{run_id:'123',letter:'A',verdict:'OK'}], ['123'], 'A'), null);
assert.equal(freshRun([{run_id:'123',letter:'A',verdict:'OK'},{run_id:'124',letter:'B',verdict:'OK'}], ['123'], 'A'), null);
assert.equal(freshRun([{run_id:'123',letter:'A',verdict:'OK'},{run_id:'124',letter:'A',verdict:'WA'}], ['123'], 'A').run_id, '124');
const serialized = await pageAction('invalid-test-action');
assert.equal(serialized.action, 'invalid-test-action');
assert.match(serialized.__error.message, /Неизвестное действие/);
assert.equal(typeof serialized.__error.stack, 'string');
const images = await pageAction('validate_image_urls', {urls: [
  'https://assets.contest.yandex.net/testsys/statement-file?hash=fixture',
  'https://official.contest.yandex.ru/contest/image.png',
  'https://assets.leetcode.com/uploads/image.png',
  'https://assets.contest.yandex.net.evil.test/image.png',
  'https://example.org/image.png',
  'http://assets.contest.yandex.net/image.png',
  'data:image/svg+xml,<svg/>',
  'https://assets.contest.yandex.net:8443/image.png',
  'https://name:password@assets.contest.yandex.net/image.png'
]});
assert.deepEqual(images.allowed, [true, true, true, false, false, false, false, false, false]);
// The description's Python3 toggle must not stand in for the actual editor language.
let editorLanguage = 'python', editorClicks = 0, descriptionClicks = 0, optionClicks = 0;
const actualButton = {innerText: 'Python3', offsetWidth: 60, parentElement: {getAttribute: () => null}, closest: () => null,
  click() { editorClicks++; }};
const descriptionButton = {innerText: 'Python3', offsetWidth: 60, parentElement: {getAttribute: key => key === 'role' ? 'group' : null},
  closest: () => null, click() { descriptionClicks++; }};
const panel = {parentElement: null, querySelectorAll: () => [descriptionButton, actualButton]};
const editorDom = {offsetWidth: 600, parentElement: panel};
const editor = {getDomNode: () => editorDom, getModel: () => ({getLanguageId: () => editorLanguage})};
globalThis.location = {hostname: 'leetcode.com'};
globalThis.window = {monaco: {editor: {getEditors: () => [editor]}}};
globalThis.document = {querySelectorAll: () => [{innerText: 'Python3', offsetWidth: 60, click() {optionClicks++; actualButton.innerText = 'Python3'; editorLanguage = 'python';}}]};
const selectedPython = await pageAction('select_python');
assert.equal(selectedPython.verified_by, 'visible-editor-model');
assert.equal(descriptionClicks, 0);
assert.equal(editorClicks, 0);
actualButton.innerText = 'C++'; editorLanguage = 'cpp';
const changedPython = await pageAction('select_python');
assert.equal(changedPython.language, 'Python3');
assert.equal(editorClicks, 1);
assert.equal(optionClicks, 1);
assert.equal(descriptionClicks, 0);
editorLanguage = 'python3';
const actualPython3Id = await pageAction('select_python');
assert.equal(actualPython3Id.verified_by, 'visible-editor-model');
assert.equal(editorClicks, 1, 'the real LeetCode python3 model ID must not reopen the menu');
assert.equal(optionClicks, 1);
// The current LC menu can expose a div option rather than ARIA option roles.
actualButton.innerText = 'C++'; editorLanguage = 'cpp';
globalThis.document = {querySelectorAll: () => [{tagName: 'DIV', innerText: 'Python3', offsetWidth: 60, closest: () => null, click() {optionClicks++; actualButton.innerText = 'Python3'; editorLanguage = 'python3';}}]};
const changedToPython3Id = await pageAction('select_python');
assert.equal(changedToPython3Id.verified_by, 'visible-editor-model');
assert.equal(editorClicks, 2);
assert.equal(optionClicks, 2);
let modelCode = '', realSubmitClicks = 0;
const python3Model = {getLanguageId: () => 'python3', setValue(value) {modelCode = value;}, getValue: () => modelCode};
globalThis.window = {monaco: {editor: {getModels: () => [python3Model, {getLanguageId: () => 'plaintext'}]}}};
globalThis.document = {querySelectorAll: () => []};
const modelOnlyFill = await pageAction('fill_editor', {code: 'print(1)\n'});
assert.equal(modelOnlyFill.filled, true);
assert.equal(modelCode, 'print(1)\n');
globalThis.sessionStorage = {getItem() {return null;}, setItem() {}};
globalThis.document = {querySelectorAll: selector => selector.startsWith('button,') ? [{innerText: 'Submit', offsetWidth: 80, disabled: false, getAttribute: () => null, click() {realSubmitClicks++;}}] : []};
const modelOnlyClick = await pageAction('click_submit', {jobId: 'python3-model-fixture', code: 'print(1)\n'});
assert.equal(modelOnlyClick.clicked, true);
assert.equal(realSubmitClicks, 1);
// A clickable Python label must not override a fixed C++ compiler selection.
const fixedValue = {innerText: 'C++20 (GCC 14.1)'};
const fixedControl = {offsetWidth: 80, querySelector: () => fixedValue, click() {}};
const fakeOption = {innerText: 'Python3', offsetWidth: 60, click() {}};
globalThis.location = {hostname: 'official.contest.yandex.ru'};
globalThis.window = {};
globalThis.document = {querySelectorAll: selector => selector === '.solution_type_compiler-list .solution__control' ? [fixedControl] : selector.startsWith('[role="option"]') ? [fakeOption] : []};
const fixedCompiler = await pageAction('select_python');
assert.match(fixedCompiler.__error.message, /не подтвердил выбор Python 3/);
// Submission history order must not hide the new run or leak an old Accepted.
const submissionLink = (id, label, slug = 'two-sum') => ({innerText: label,
  href: `https://leetcode.com/problems/${slug}/submissions/${id}/`, getAttribute() {return this.href;}, closest() {return null;}});
const history = [submissionLink('123', '3 Accepted Oct 18, 2026 Python3'), submissionLink('125', '4 Wrong Answer Nov 20, 2026 Python3'), submissionLink('999', 'Accepted', 'another-problem')];
let liveStatus = null;
globalThis.location = {hostname: 'leetcode.com', pathname: '/problems/two-sum/description/', href: 'https://leetcode.com/problems/two-sum/description/'};
globalThis.document = {querySelectorAll: selector => selector.startsWith('a[') ? history : liveStatus ? [liveStatus] : []};
const listed = await pageAction('read_verdict', {problemUrl: 'https://leetcode.com/problems/two-sum/'});
assert.deepEqual(listed.rows.map(row => row.run_id), ['123', '125']);
assert.equal(freshRun(listed.rows, ['123'], null).verdict, 'Wrong Answer');
globalThis.location.pathname = '/problems/two-sum/submissions/127/';
liveStatus = {innerText: 'Accepted\n103 / 103 testcases passed', offsetWidth: 80};
const finished = await pageAction('read_verdict', {problemUrl: 'https://leetcode.com/problems/two-sum/'});
assert.equal(freshRun(finished.rows, ['123', '125'], null).run_id, '127');
assert.equal(freshRun(finished.rows, ['123', '125'], null).verdict, 'Accepted');
globalThis.location.pathname = '/problems/two-sum/submissions/128/';
liveStatus = null;
const pending = await pageAction('read_verdict', {problemUrl: 'https://leetcode.com/problems/two-sum/'});
assert.equal(freshRun(pending.rows, ['123', '125'], null).run_id, '128');
assert.equal(terminalVerdict(freshRun(pending.rows, ['123', '125'], null).verdict), null);
const changedTask = await pageAction('read_verdict', {problemUrl: 'https://leetcode.com/problems/different-task/'});
assert.match(changedTask.__error.message, /другую задачу/);
console.log('Extension URL, verdict, and new-submission checks passed.');
