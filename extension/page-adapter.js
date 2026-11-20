// Executed only in an allowlisted problem tab. Keep this function self-contained.
export async function pageAction(action, payload = {}) {
  try {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = el => (el?.innerText || el?.textContent || '').trim();
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const pythonModel = model => /^python3?$/i.test(model?.getLanguageId?.() || '');
  const directText = el => [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.nodeValue.trim()).filter(Boolean).join(' ');
  const languageNodes = () => [...document.querySelectorAll('body *')].filter(el => !el.closest('.CodeMirror,.monaco-editor,.ace_editor,.cm-editor,.problem-statement,pre,code,table') && visible(el))
    .filter(el => /^(?:C\+\+|Python|PyPy|Java|Go\b|Rust|JavaScript)/i.test(directText(el)) && directText(el).length < 130);
  const absolute = (href, base) => { try { return new URL(href, base).href; } catch { return ''; } };
  const statementImageUrl = (raw, base) => {
    try {
      const url = new URL(raw, base);
      const origins = new Set(['https://official.contest.yandex.ru', 'https://assets.contest.yandex.net', 'https://assets.leetcode.com']);
      return !url.username && !url.password && origins.has(url.origin) ? url.href : null;
    } catch { return null; }
  };
  const safeHtml = (element, base) => {
    if (!element) return '';
    const copy = element.cloneNode(true);
    // Keep the native MathML branch only; KaTeX's visual HTML and TeX annotations duplicate it.
    copy.querySelectorAll('.katex-html,.MathJax_Preview,annotation,annotation-xml').forEach(el => el.remove());
    copy.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,link,meta,noscript').forEach(el => el.remove());
    const tags = new Set('DIV SPAN P BR H1 H2 H3 H4 UL OL LI PRE CODE STRONG EM B I U SUB SUP TABLE THEAD TBODY TR TH TD BLOCKQUOTE A IMG MATH MROW MI MN MO MSUP MSUB MSUBSUP MFRAC MSQRT MROOT MTEXT MTABLE MTR MTD MFENCED MOVER MUNDER MUNDEROVER MMULTISCRIPTS MPRESCRIPTS NONE MSTYLE MPADDED MSPACE MENCLOSE MERROR SEMANTICS'.split(' '));
    const mathAttrs = new Set('display mathvariant stretchy fence accent accentunder separator columnalign rowalign columnspacing rowspacing columnspan rowspan linethickness notation maxsize minsize scriptlevel displaystyle'.split(' '));
    for (const el of [...copy.querySelectorAll('*')]) {
      if (!tags.has(el.tagName.toUpperCase())) { el.replaceWith(...el.childNodes); continue; }
      for (const attr of [...el.attributes]) {
        const isMath = el.namespaceURI === 'http://www.w3.org/1998/Math/MathML';
        const allowed = ['alt', 'colspan', 'rowspan'].includes(attr.name) || (el.tagName === 'A' && attr.name === 'href')
          || (el.tagName === 'IMG' && attr.name === 'src') || (isMath && mathAttrs.has(attr.name));
        if (!allowed) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A') {
        const u = absolute(el.getAttribute('href'), base);
        if (/^https?:\/\//.test(u)) { el.setAttribute('href', u); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        else el.removeAttribute('href');
      }
      if (el.tagName === 'IMG') {
        const u = statementImageUrl(el.getAttribute('src'), base);
        if (u) el.setAttribute('src', u);
        else el.remove();
      }
    }
    return copy.innerHTML.slice(0, 1000000);
  };
  // Pure policy action used by local regression checks; performs no requests or DOM changes.
  if (action === 'validate_image_urls') return {allowed: (payload.urls || []).map(url => !!statementImageUrl(url, payload.base || 'https://official.contest.yandex.ru/'))};
  const runRows = doc => [...doc.querySelectorAll('tr')].map(row => {
    const a = row.querySelector('a[href*="/run-report/"]');
    const id = a?.getAttribute('href')?.match(/\/run-report\/(\d+)/)?.[1];
    if (!id) return null;
    const cells = [...row.querySelectorAll('td')].map(text);
    const status = [...row.querySelectorAll('a[href*="/run-report/"]')].map(text).find(t => /^(OK|WA|TL|ML|RE|CE|PE|SV|Accepted|Wrong Answer|Time Limit|Runtime Error|Compilation Error)/i.test(t));
    return {run_id: id, letter: cells.find(t => /^[A-Z](?:\d+)?$/.test(t)) || '', verdict: status || cells[4] || '', text: cells.join(' | ')};
  }).filter(Boolean);

  if (action === 'inspect_statement') {
    const url = new URL(payload.url || location.href, location.href);
    if (url.origin !== location.origin || !/^\/contest\/\d+\/problems\//.test(url.pathname)) throw Error('Недопустимый адрес условия.');
    let doc = document;
    if (payload.fetch || url.href !== location.href) {
      const response = await fetch(url.href, {credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw Error(`Контест вернул HTTP ${response.status}.`);
      doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    }
    const root = doc.querySelector('.problem-statement');
    if (!root) throw Error('Условие не найдено.');
    const sections = [...root.children].map(el => ({tag: el.tagName, classes: String(el.className || ''), text_length: text(el).length, text: text(el).slice(0, 2000)}));
    return {url: url.href, text_length: text(root).length, html_length: root.innerHTML.length,
      child_sections: sections, legend: text(root.querySelector('.legend')).slice(0, 2000),
      images: [...root.querySelectorAll('img')].map(el => ({src: absolute(el.getAttribute('src'), url.href), raw_src: el.getAttribute('src'), alt: el.getAttribute('alt'),
        parent_tag: el.parentElement?.tagName, parent_class: String(el.parentElement?.className || ''), width: el.getAttribute('width'), height: el.getAttribute('height')})),
      svg_count: root.querySelectorAll('svg').length,
      svg_summaries: [...root.querySelectorAll('svg')].map(el => ({width: el.getAttribute('width'), height: el.getAttribute('height'), title: text(el.querySelector('title')), element_count: el.querySelectorAll('*').length})),
      objects: [...root.querySelectorAll('object,embed,iframe,canvas')].map(el => ({tag: el.tagName, src: absolute(el.getAttribute('src') || el.getAttribute('data'), url.href)})),
      cleaned_html_length: safeHtml(root, url.href).length};
  }

  if (action === 'read_yandex') {
    const url = new URL(payload.url || location.href, location.href);
    if (url.origin !== location.origin || !/^\/contest\/\d+\/problems\//.test(url.pathname)) throw Error('Недопустимый адрес задачи.');
    let doc = document;
    if (payload.fetch || url.href !== location.href) {
      const response = await fetch(url.href, {credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw Error(`Контест вернул HTTP ${response.status}.`);
      doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    }
    const root = doc.querySelector('.problem-statement');
    if (!root) {
      const message = text(doc.body);
      if (/авторизоваться|войти в аккаунт|log in|sign in/i.test(message)) throw Error('Нужно войти в Яндекс Контест в Dia.');
      if (/не зарегистрированы|зарегистрироваться|регистраци/i.test(message)) throw Error('Нет доступа к этому контесту. Открой его в Dia.');
      throw Error('Условие не найдено. Открой контест и проверь доступ.');
    }
    const rawTitle = text(root.querySelector('.title, h1, h2'));
    const letter = rawTitle.match(/^([A-Z](?:\d+)?)\./)?.[1] || decodeURIComponent(url.pathname.match(/\/problems\/([^/]+)/)?.[1] || 'A');
    const contestId = String(payload.contestId || url.pathname.match(/\/contest\/(\d+)/)?.[1] || '');
    const links = [...doc.querySelectorAll('a[href]')].map(a => ({url: absolute(a.getAttribute('href'), url.href), title: text(a)}))
      .filter(a => { const target = new URL(a.url || url.href); return target.origin === url.origin && new RegExp(`/contest/${contestId}/problems/[^/?#]+/?$`).test(target.pathname); });
    const unique = [...new Map(links.map(a => [a.url.replace(/\/$/, ''), a])).values()];
    const examples = [...root.querySelectorAll('table')].filter(table => {
      const headers = [...table.querySelectorAll('th')].map(text);
      return table.classList.contains('sample-tests') || (headers.length === 2 && /^(Ввод|Input)$/i.test(headers[0]) && /^(Вывод|Output)$/i.test(headers[1]));
    }).map(table => {
      const row = [...table.querySelectorAll('tbody tr, tr')].find(r => r.querySelectorAll('td').length >= 2);
      const cells = row ? [...row.querySelectorAll('td')] : [];
      return cells.length >= 2 ? {input: text(cells[0].querySelector('pre') || cells[0]), output: text(cells[1].querySelector('pre') || cells[1])} : null;
    }).filter(Boolean);
    const rows = runRows(doc);
    return {links: unique, rows, problem: {
      id: `yandex-${contestId}-${letter}`, source: 'yandex', externalId: `${contestId}/${letter}`, contestId, letter,
      title: rawTitle.replace(/^[A-Z](?:\d+)?\.\s*/, '') || letter,
      url: `${url.origin}/contest/${contestId}/problems/${encodeURIComponent(letter)}/`,
      topicIds: payload.topicId ? [payload.topicId] : [], difficulty: 'Unknown', statement_html: safeHtml(root, url.href), examples,
      starter_code: '# Python 3\nimport sys\n\ndef solve():\n    data = sys.stdin.read().split()\n    # Напиши решение здесь\n\nif __name__ == "__main__":\n    solve()\n',
      solved: rows.some(r => r.letter === letter && /^(OK|Accepted)$/.test(r.verdict)), imported: true
    }};
  }

  if (action === 'read_leetcode') {
    const slug = location.pathname.match(/\/problems\/([^/]+)/)?.[1];
    if (!slug) throw Error('Открой страницу задачи LeetCode.');
    let question = null;
    // Read only the question payload already available to this browser session.
    const next = document.querySelector('#__NEXT_DATA__');
    if (next) {
      const walk = (value, depth = 0) => {
        if (depth > 14 || !value || typeof value !== 'object' || question) return;
        if (value.titleSlug === slug && (value.content || value.codeSnippets)) { question = value; return; }
        for (const item of Array.isArray(value) ? value : Object.values(value)) walk(item, depth + 1);
      };
      try { walk(JSON.parse(next.textContent)); } catch {}
    }
    if (!question?.content || !question?.codeSnippets) {
      // Read-only question request from the site's own page/session. Submission remains a visible UI action.
      try {
        const response = await fetch('/graphql/', {method: 'POST', credentials: 'include', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({operationName: 'questionData', variables: {titleSlug: slug},
            query: 'query questionData($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug content difficulty exampleTestcases isPaidOnly codeSnippets { lang langSlug code } } }'})});
        if (response.ok) { const result = await response.json(); if (result.data?.question?.content) question = {...question, ...result.data.question}; }
      } catch {}
    }
    const root = document.querySelector('[data-track-load="description_content"], [data-cy="question-content"], .elfjS');
    const titleText = question?.title || text(document.querySelector('[data-cy="question-title"], a[href$="/description/"]')) || document.title.split(' - ')[0];
    const titleMatch = titleText.match(/^(\d+)\.\s*(.+)/);
    const numeric = String(question?.questionFrontendId || titleMatch?.[1] || payload.externalId || '');
    if ((!question?.content && !root) || (question?.isPaidOnly && !question.content) || /subscribe to unlock|premium access|only available for premium|订阅.*解锁/i.test(text(root))) throw Error('Условие недоступно этому аккаунту LeetCode.');
    const template = question?.codeSnippets?.find(s => s.langSlug === 'python3')?.code || '';
    const match = template.match(/def\s+(?!__)(\w+)\s*\(\s*self\s*,?([^)]*)\)/);
    const className = template.match(/class\s+(\w+)\s*[:(]/)?.[1];
    const splitParams = raw => {
      const parts = []; let depth = 0, start = 0;
      for (let i = 0; i < raw.length; i++) {
        if ('[({'.includes(raw[i])) depth++;
        if ('])}'.includes(raw[i])) depth--;
        if (raw[i] === ',' && depth === 0) { parts.push(raw.slice(start, i)); start = i + 1; }
      }
      parts.push(raw.slice(start));
      return parts.map(part => { const [name, ...rest] = part.trim().split(':'); return {name: name.trim(), type: rest.join(':').split('=')[0].trim()}; }).filter(param => param.name && param.name !== 'self');
    };
    const signature = className && className !== 'Solution' ? {kind: 'design', class_name: className, params: []}
      : match ? {method: match[1], params: splitParams(match[2])} : null;
    const container = document.createElement('div');
    if (question?.content) container.innerHTML = question.content;
    else if (root) container.append(root.cloneNode(true));
    const examples = [...container.querySelectorAll('pre')].map(pre => {
      const sample = text(pre).match(/Input:\s*([\s\S]*?)\s*Output:\s*([\s\S]*?)(?:\s*Explanation:|$)/i);
      if (!sample) return null;
      let input = sample[1].trim();
      if (signature?.kind === 'design') {
        const lines = input.split('\n').map(line => line.trim()).filter(Boolean);
        try { if (lines.length === 2) input = JSON.stringify({operations: JSON.parse(lines[0]), arguments: JSON.parse(lines[1])}); } catch {}
      }
      return {input, output: sample[2].trim()};
    }).filter(Boolean);
    if (!examples.length && question?.exampleTestcases && signature?.params?.length) {
      const lines = question.exampleTestcases.split('\n');
      for (let i = 0; i < lines.length; i += signature.params.length) examples.push({input: lines.slice(i, i + signature.params.length).join('\n'), output: ''});
    }
    const difficulty = question?.difficulty || [...document.querySelectorAll('[class*="difficulty"], [class*="text-difficulty"]')].map(text).find(t => /^(Easy|Medium|Hard)$/.test(t)) || payload.difficulty || 'Unknown';
    return {problem: {id: payload.problemId || `leetcode-${numeric || slug}`, source: 'leetcode', externalId: numeric || slug,
      title: titleMatch?.[2] || titleText.replace(/ - LeetCode.*/, ''), url: `https://leetcode.com/problems/${slug}/`,
      topicIds: payload.topicIds || [], difficulty, statement_html: safeHtml(container, location.href), examples,
      starter_code: template || '# Вставь Python-шаблон задачи из LeetCode.\n', signature, imported: true, solved: !!payload.solved}};
  }

  if (action === 'inspect_form') {
    const summarize = el => ({tag: el.tagName, classes: String(el.className?.baseVal || el.className || '').slice(0, 220), id: el.id || '', role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'), ariaControls: el.getAttribute('aria-controls'), ariaHaspopup: el.getAttribute('aria-haspopup'), ariaExpanded: el.getAttribute('aria-expanded'), dataLanguage: el.getAttribute('data-language'), dataValue: el.getAttribute('data-value'), visible: visible(el)});
    const selectors = [...document.querySelectorAll('select')].filter(el => [...el.options].some(option => /Python|C\+\+|PyPy/i.test(option.textContent))).map(el => ({...summarize(el), value: el.value,
      options: [...el.options].map(option => ({value: option.value, label: option.textContent.trim(), selected: option.selected}))}));
    const controls = [...document.querySelectorAll('button,[role="combobox"],[role="option"],[role="listbox"],span[class*="select"],[class*="select2"],[class*="select__button"],[class*="select__control"],label')].filter(visible)
      .filter(el => /Python|C\+\+|PyPy|Java|Язык|Language|компилятор|compiler/i.test(text(el)) && text(el).length < 300).slice(0, 30).map(el => ({...summarize(el), text: text(el)}));
    const editorElements = [...document.querySelectorAll('.monaco-editor,.ace_editor,.CodeMirror,.cm-editor,textarea,[contenteditable="true"]')].slice(0, 20).map(summarize);
    const compilerBlock = document.querySelector('.solution_type_compiler-list');
    const safeConfig = (value, key = '', depth = 0) => {
      // Positive allowlist: this BEM block also contains the user's sourceCode.
      // Never export that source or unrelated configuration, even under an unexpected key.
      if (depth > 4 || !value || typeof value !== 'object' || Array.isArray(value)) return {};
      const out = {};
      for (const [name, item] of Object.entries(value)) {
        if (/^(compilerId|contestId|maxFileSize|problemId)$/i.test(name) && ['string', 'number', 'boolean'].includes(typeof item)) out[name] = typeof item === 'string' ? item.slice(0, 200) : item;
        else if (name === 'solution' && item && typeof item === 'object') out[name] = safeConfig(item, name, depth + 1);
      }
      return out;
    };
    let compilerBem = null;
    let compilerRaw = null;
    if (compilerBlock) {
      const clone = compilerBlock.cloneNode(true);
      clone.querySelectorAll('textarea,.CodeMirror,.monaco-editor,.ace_editor,.cm-editor,pre,code,script,input,style').forEach(el => el.remove());
      for (const el of [clone, ...clone.querySelectorAll('*')]) {
        for (const attr of [...el.attributes]) {
          if (attr.name === 'data-bem') {
            try { const parsed = safeConfig(JSON.parse(attr.value)); el.setAttribute('data-bem', JSON.stringify(parsed)); if (el === clone) compilerBem = parsed; }
            catch { el.setAttribute('data-bem', '[non-JSON omitted]'); }
          } else if (!['class','id','role','for','aria-label','aria-expanded','aria-disabled','title','type','name','tabindex'].includes(attr.name)) el.removeAttribute(attr.name);
        }
      }
      compilerRaw = clone.outerHTML.slice(0, 20000);
    }
    const label = [...document.querySelectorAll('label')].find(el => /^Язык$|^Language$/i.test(text(el)));
    const pruneControl = element => {
      if (!element) return null;
      const clone = element.cloneNode(true);
      clone.querySelectorAll('textarea,.CodeMirror,.monaco-editor,.ace_editor,.cm-editor,pre,code,script,input,style').forEach(el => el.remove());
      for (const el of [clone, ...clone.querySelectorAll('*')]) for (const attr of [...el.attributes]) if (!['class','id','role','for','aria-label','title','type','name','tabindex'].includes(attr.name)) el.removeAttribute(attr.name);
      return clone.outerHTML.slice(0, 14000);
    };
    return {url: location.origin + location.pathname, selects: selectors, controls, editorElements,
      compilerControlRaw: compilerRaw, compilerBemConfig: compilerBem,
      bemAvailable: {BEM: !!window.BEM, DOM: !!window.BEM?.DOM, solutionBlock: !!window.BEM?.blocks?.solution, jQuery: !!window.jQuery},
      language_nodes: languageNodes().slice(0, 30).map(el => ({...summarize(el), direct_text: directText(el), parent: summarize(el.parentElement)})),
      language_label_parent: pruneControl(label?.parentElement), language_label_grandparent: pruneControl(label?.parentElement?.parentElement),
      globals: {monaco: !!window.monaco, monacoModels: !!window.monaco?.editor?.getModels, monacoEditors: !!window.monaco?.editor?.getEditors,
        ace: !!window.ace, CodeMirror: !!window.CodeMirror, require: !!window.require, editor: typeof window.editor},
      monacoModelLanguages: window.monaco?.editor?.getModels?.().map(model => model.getLanguageId?.()) || []};
  }

  if (action === 'select_python') {
    if (location.hostname === 'leetcode.com') {
      const isPython3 = label => /^(?:Python\s*3|PyPy\s*3)(?:\b|$)/i.test(label);
      const isLanguage = label => /^(?:Python(?:\s*\d[\d.]*)?|PyPy(?:\s*\d[\d.]*)?|C\+\+(?:\s*\d+)?|Java|JavaScript|TypeScript|Go|Rust|Kotlin|Swift|Ruby|C#|C|PHP|Dart|Scala|Elixir|Erlang|Racket)$/i.test(label);
      const currentEditor = () => (window.monaco?.editor?.getEditors?.() || []).find(editor => visible(editor.getDomNode?.()));
      const editorLanguageButton = editor => {
        let node = editor?.getDomNode?.()?.parentElement;
        for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
          const found = [...node.querySelectorAll('button,[role="combobox"]')].filter(visible).find(button =>
            button.parentElement?.getAttribute('role') !== 'group' && !button.closest('[data-track-load="description_content"],[data-cy="question-content"],.elfjS') && isLanguage(text(button)));
          if (found) return found;
        }
        return null;
      };
      const readyUntil = Date.now() + 10000;
      let editor = null, control = null;
      while (Date.now() < readyUntil) {
        editor = currentEditor(); control = editorLanguageButton(editor);
        if (editor?.getModel?.() && control) break;
        await pause(200);
      }
      if (!editor?.getModel?.() || !control) throw Error('Редактор LeetCode ещё не готов. Дождись появления редактора и языка, затем повтори отправку.');
      if (isPython3(text(control)) && pythonModel(editor.getModel())) return {language: text(control), verified_by: 'visible-editor-model'};
      control.click();
      let candidate = null;
      const optionsUntil = Date.now() + 3000;
      while (!candidate && Date.now() < optionsUntil) {
        const menuId = control.getAttribute?.('aria-controls');
        const menu = menuId ? document.getElementById(menuId) : null;
        const options = [...(menu || document).querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],[role="listbox"] button,[role="menu"] button,[data-radix-popper-content-wrapper] button,button,[data-language],[data-value],div,span')].filter(visible)
          .filter(option => option !== control && !option.closest?.('a,table,.monaco-editor,.CodeMirror,.ace_editor,pre,code,[role="group"],[data-track-load="description_content"],[data-cy="question-content"],.elfjS'));
        candidate = options.find(option => /^Python\s*3(?:\b|$)/i.test(text(option))) || options.find(option => /^PyPy\s*3(?:\b|$)/i.test(text(option)));
        if (!candidate) await pause(150);
      }
      if (!candidate) throw Error('Python 3 не найден в меню языка редактора LeetCode. Код не отправлен.');
      candidate.click();
      const confirmUntil = Date.now() + 3000;
      while (Date.now() < confirmUntil) {
        editor = currentEditor(); control = editorLanguageButton(editor);
        if (pythonModel(editor?.getModel?.()) && isPython3(text(control))) return {language: text(control), verified_by: 'visible-editor-model'};
        await pause(150);
      }
      throw Error('LeetCode не подтвердил Python 3 в редакторе. Код не отправлен.');
    }
    const desired = option => /(?:Python\s*3|PyPy\s*3|python3)/i.test(option);
    const selects = [...document.querySelectorAll('select')];
    const compiler = selects.find(s => [...s.options].some(o => desired(o.textContent)));
    if (compiler) {
      const options = [...compiler.options];
      const candidate = options.find(o => /Python\s*3|python3/i.test(o.textContent)) || options.find(o => desired(o.textContent));
      compiler.value = candidate.value;
      compiler.dispatchEvent(new Event('input', {bubbles: true})); compiler.dispatchEvent(new Event('change', {bubbles: true}));
      await pause(450);
      return {language: candidate.textContent.trim()};
    }
    const yandexControl = [...document.querySelectorAll('.solution_type_compiler-list .solution__control')].find(visible);
    const yandexValue = text(yandexControl?.querySelector('.solution__value'));
    if (/^Python\s*3|^PyPy\s*3/i.test(yandexValue)) return {language: yandexValue};
    const buttons = [...document.querySelectorAll('button, [role="combobox"], [role="button"], span[class*="select"], .select2__button, .select__button')].filter(visible);
    const current = buttons.find(el => /^(Python3?|Python 3[^\n]*|PyPy3?[^\n]*)$/i.test(text(el)));
    if (current && !yandexControl) return {language: text(current)};
    const language = yandexControl || buttons.find(el => /^(C\+\+|Java|Python|PyPy|Go|Rust|JavaScript)/.test(text(el)) && text(el).length < 100)
      || [...document.querySelectorAll('[class*="select2__button"], [class*="select__button"], [class*="select2__control"], [class*="select__control"]')].find(visible)
      || languageNodes()[0];
    if (!language) throw Error('Не найден выбор языка. Выбери Python 3 на странице задачи и повтори.');
    language.click(); await pause(350);
    const options = [...document.querySelectorAll('[role="option"], [role="menuitem"], li, [class*="select__item"], [class*="select2__item"], [class*="menu__item"], [class*="menu-item"]')].filter(visible).concat(languageNodes());
    const candidate = options.find(el => /^Python\s*3[^\n]*$/i.test(text(el))) || options.find(el => /^PyPy\s*3[^\n]*$/i.test(text(el)));
    if (!candidate) throw Error(yandexControl ? `На странице сейчас указан ${yandexValue || 'другой компилятор'}, а Python 3 не выбирается. Используй локальный Submit или другую площадку.` : 'Python 3 не найден в доступных языках. Выбери его вручную.');
    candidate.click(); await pause(450);
    if (yandexControl) {
      const selected = text(yandexControl.querySelector('.solution__value'));
      if (!desired(selected)) throw Error('Контест не подтвердил выбор Python 3. Код не вставлен. Используй локальный Submit или другую площадку.');
      return {language: selected, verified_by: 'compiler-control'};
    }
    return {language: text(candidate)};
  }

  if (action === 'fill_editor') {
    const code = String(payload.code || '');
    let read = null;
    const monaco = window.monaco;
    const editors = monaco?.editor?.getEditors?.() || [];
    const editor = editors.find(e => visible(e.getDomNode?.())) || (editors.length === 1 ? editors[0] : null);
    if (editor) { editor.setValue(code); read = () => editor.getValue(); }
    if (!read && monaco?.editor?.getModels) {
      const models = monaco.editor.getModels().filter(pythonModel);
      if (models.length === 1) { models[0].setValue(code); read = () => models[0].getValue(); }
    }
    if (!read) {
      const aceEl = [...document.querySelectorAll('.ace_editor')].find(visible);
      if (aceEl && window.ace?.edit) { const ace = window.ace.edit(aceEl); ace.setValue(code, -1); read = () => ace.getValue(); }
    }
    if (!read) {
      const cm = [...document.querySelectorAll('.CodeMirror')].map(e => e.CodeMirror).find(Boolean);
      if (cm) {
        cm.setValue(code); cm.save?.();
        const area = cm.getTextArea?.();
        if (area) { area.dispatchEvent(new Event('input', {bubbles: true})); area.dispatchEvent(new Event('change', {bubbles: true})); }
        read = () => cm.getValue();
      }
    }
    if (!read) {
      const candidate = [...document.querySelectorAll('textarea')].filter(visible).find(el =>
        !el.closest('.monaco-editor, .ace_editor, .CodeMirror, .cm-editor') && !/search|comment/i.test(el.name || el.placeholder || ''));
      if (candidate) {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(candidate, code);
        candidate.dispatchEvent(new Event('input', {bubbles: true})); candidate.dispatchEvent(new Event('change', {bubbles: true})); read = () => candidate.value;
      }
    }
    if (!read) throw Error('Редактор сайта не распознан. Код не отправлен.');
    await pause(300);
    if (read().replace(/\r\n/g, '\n') !== code.replace(/\r\n/g, '\n')) throw Error('Код в редакторе не совпал с исходником. Отправка остановлена.');
    return {filled: true, length: code.length, rows: runRows(document)};
  }

  if (action === 'click_submit') {
    const marker = `algo-practice-submitted:${payload.jobId}`;
    if (sessionStorage.getItem(marker)) return {already_clicked: true, rows: runRows(document)};
    // Re-read immediately before clicking, so a later manual edit cannot submit a different source.
    let live = null;
    const editors = window.monaco?.editor?.getEditors?.() || [];
    const editor = editors.find(e => visible(e.getDomNode?.())) || (editors.length === 1 ? editors[0] : null);
    if (editor) live = editor.getValue();
    if (live === null) {
      const models = window.monaco?.editor?.getModels?.().filter(pythonModel) || [];
      if (models.length === 1) live = models[0].getValue();
    }
    if (live === null) {
      const aceEl = [...document.querySelectorAll('.ace_editor')].find(visible);
      if (aceEl && window.ace?.edit) live = window.ace.edit(aceEl).getValue();
    }
    if (live === null) {
      const cm = [...document.querySelectorAll('.CodeMirror')].map(e => e.CodeMirror).find(Boolean);
      if (cm) live = cm.getValue();
    }
    if (live === null) live = [...document.querySelectorAll('textarea')].filter(visible).find(el =>
      !el.closest('.monaco-editor, .ace_editor, .CodeMirror, .cm-editor') && !/search|comment/i.test(el.name || el.placeholder || ''))?.value ?? null;
    if (live === null || live.replace(/\r\n/g, '\n') !== String(payload.code).replace(/\r\n/g, '\n')) throw Error('Перед отправкой код изменился или редактор недоступен. Отправка остановлена.');
    const buttons = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].filter(visible);
    const submit = buttons.find(el => /^(Отправить|Submit|Отправить решение)$/i.test(text(el) || el.value));
    if (!submit || submit.disabled || submit.getAttribute('aria-disabled') === 'true') throw Error('Кнопка отправки недоступна. Код остаётся в редакторе.');
    const rows = runRows(document);
    sessionStorage.setItem(marker, String(Date.now()));
    submit.click();
    return {clicked: true, rows};
  }

  if (action === 'read_verdict') {
    if (payload.problemUrl) {
      const expected = new URL(payload.problemUrl);
      const actualTask = location.pathname.match(location.hostname === 'leetcode.com' ? /^\/problems\/([^/]+)/ : /^\/contest\/(\d+)/)?.[1];
      const expectedTask = expected.pathname.match(expected.hostname === 'leetcode.com' ? /^\/problems\/([^/]+)/ : /^\/contest\/(\d+)/)?.[1];
      if (expected.hostname !== location.hostname || !actualTask || actualTask !== expectedTask) throw Error('Вкладка перешла на другую задачу. Проверь посылку на исходной площадке; повторной отправки не было.');
    }
    if (location.hostname === 'official.contest.yandex.ru') return {rows: runRows(document)};
    const canonical = raw => {
      const value = String(raw || '').replace(/\s+/g, ' ').trim();
      const match = value.match(/^(?:\d+\s*)?(Accepted|Wrong Answer|Time Limit Exceeded|Memory Limit Exceeded|Runtime Error|Compilation Error|Compile Error|Output Limit Exceeded|Pending|Judging|Running)(?=\b|$)/i);
      if (!match) return '';
      return /^Compile Error$/i.test(match[1]) ? 'Compilation Error' : match[1];
    };
    const slug = location.pathname.match(/^\/problems\/([^/]+)/)?.[1];
    const rows = new Map();
    for (const anchor of document.querySelectorAll('a[href*="/submissions/"]')) {
      let target;
      try { target = new URL(anchor.getAttribute('href') || anchor.href, location.href); } catch { continue; }
      const targetSlug = target.pathname.match(/^\/problems\/([^/]+)/)?.[1];
      const identifier = target.pathname.match(/\/submissions\/(\d+)/)?.[1];
      if (target.hostname !== 'leetcode.com' || !identifier || (slug && targetSlug !== slug)) continue;
      const row = anchor.closest('[role="row"],tr') || anchor;
      const label = canonical(text(row).slice(0, 1500));
      const existing = rows.get(identifier);
      rows.set(identifier, {run_id: identifier, letter: '', verdict: label || existing?.verdict || ''});
    }
    const currentId = location.pathname.match(/\/submissions\/(\d+)/)?.[1];
    const status = [...document.querySelectorAll('[data-e2e-locator="submission-result"], [data-e2e-locator="submission-status"], [class*="result-container"]')].filter(visible)
      .map(element => ({raw: text(element), verdict: canonical(text(element))})).find(item => item.verdict);
    if (currentId) rows.set(currentId, {run_id: currentId, letter: '', verdict: status?.verdict || rows.get(currentId)?.verdict || ''});
    return {rows: [...rows.values()], visible_status: status?.raw || '', current_run_id: currentId || null};
  }
  throw Error('Неизвестное действие адаптера.');
  } catch (error) {
    return {__error: {message: String(error?.message || error), stack: String(error?.stack || '').split('\n').slice(0, 7).join('\n')}, action};
  }
}
