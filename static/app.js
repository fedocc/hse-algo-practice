/* Local Algo Practice. No remote service calls; all execution stays on localhost. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = {data:null,currentId:null,view:'workspace',description:'description',console:'tests',editor:null,models:new Map(),viewStates:new Map(),breakpoints:new Map(),changing:false,saves:new Map(),dirty:new Set(),savedDrafts:new Map(),draftWrites:new Map(),debug:null,debugTimer:null,bridge:null,knownJobs:new Map(),pair:[],interview:null,running:false,selectedTopic:null,customTest:false,fontSize:14,consoleCollapsed:true,submitModes:new Map(),submitRenderKey:null,judgeResults:new Map(),testCases:new Map(),testSelections:new Map(),runResults:new Map(),lastResultKind:new Map()};
  const icon = (name, cls='') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const current = () => state.data?.problems.find((p) => p.id === state.currentId);
  const topicOf = (id) => state.data?.topics.find((t) => t.id === id);
  const topicIds = (p) => Array.isArray(p?.topicIds) ? p.topicIds : [];
  const draftOf = (p) => state.data.drafts[p.id] || (state.data.drafts[p.id] = {});
  const statusOf = (p) => state.data?.drafts[p.id]?.status || (p.solved ? 'solved' : 'todo');
  const isSolved = (p) => p.solved || statusOf(p) === 'solved';
  const statusSymbol = (p) => ({solved:'✓',review:'↺',todo:'○'}[statusOf(p)] || '○');
  const sourceName = (p) => p.source === 'leetcode' ? 'LeetCode' : (state.data?.contests.find((c) => String(c.id) === String(p.contestId))?.title || `Контест ${p.contestId || ''}`);
  const difficulty = (p) => ['Easy','Medium','Hard'].includes(p.difficulty) ? p.difficulty : 'Не указана';
  const priorityOf = (p) => p.interview_priority ?? state.data?.contests.find((c) => String(c.id) === String(p.contestId))?.interview_priority ?? true;
  const statementReady = (p) => typeof p.statement_html==='string' && !!p.statement_html.trim() && !p.statement_incomplete;
  const cleanTitle = (p) => p.letter && p.title.startsWith(`${p.letter}. `) ? p.title.slice(p.letter.length + 2) : p.title;
  const defaultCode = (p) => p?.starter_code || '# Решение на Python\n\n';

  const localTestCount = (problem) => Math.max(0,Math.trunc(Number(problem?.local_test_count)||0));
  const testKindLabel = (problem) => ({generated:'Сгенерированные тесты',published:'Опубликованные тесты',mixed:'Опубликованные и сгенерированные тесты'})[problem?.local_test_provenance?.kind]||'Локальные тесты';
  function submitModeFor(problem){
    if(!problem)return 'official';
    const requested=state.submitModes.get(problem.id);
    if(requested==='local')return 'local';
    if(requested==='official')return 'official';
    return problem.source==='yandex'&&(localTestCount(problem)>0||problem.local_test_error)?'local':'official';
  }
  function testProvenanceDetails(problem){
    const count=localTestCount(problem);if(!count)return '';
    const source=problem.local_test_provenance||{};
    const link=/^https?:\/\//i.test(source.source_url||'')?`<a href="${escape(source.source_url)}" target="_blank" rel="noopener noreferrer">Источник набора ${icon('link')}</a>`:'';
    return `<details class="local-test-provenance"><summary>${escape(testKindLabel(problem))} · ${count}</summary>${source.title?`<p>${escape(source.title)}</p>`:''}${source.notes?`<p>${escape(source.notes)}</p>`:''}${source.oracle?`<p>Эталон: ${escape(source.oracle)}</p>`:''}${link}<p>Результат относится к этому локальному набору.</p></details>`;
  }
  function renderSubmitMode(){
    const p=current(),count=localTestCount(p),mode=submitModeFor(p);
    const key=JSON.stringify([p?.id,count,mode,p?.local_test_provenance,state.bridge?.paused,state.bridge?.connected]);
    if(state.submitRenderKey===key)return;state.submitRenderKey=key;
    $('submit-icon').setAttribute('href',mode==='local'?'#i-check-square':'#i-cloud');
    $('submit-button').title=mode==='local'?`Локальная проверка · ${count} тестов`:'Dia · официальная проверка';
    $('submit-mode-button').title=`Способ проверки: ${mode==='local'?'локально · '+count+' тестов':'Dia · официально'}`;
    $('submit-local-label').textContent=count?`Локально · ${count} тестов`:'Локально · нет набора';
    $('submit-local-note').textContent=count?testKindLabel(p):(p?.local_test_error?'Набор недоступен':'Набор для этой задачи ещё не подключён');
    $('submit-local-option').disabled=!count;
    $('submit-official-note').textContent=state.bridge?.paused?'Dia на паузе':state.bridge?.connected?'Проверка в источнике задачи':'Нужно подключение Dia';
    for(const choice of ['local','official']){const button=$(`submit-${choice}-option`);button.classList.toggle('active',choice===mode);button.setAttribute('aria-checked',String(choice===mode));}
    $('submit-provenance').innerHTML=p?testProvenanceDetails(p):'';
  }
  function setSubmitMenu(open){
    $('submit-mode-menu').hidden=!open;$('submit-mode-button').setAttribute('aria-expanded',String(open));
    if(open){renderSubmitMode();const selected=$('submit-mode-menu').querySelector('[aria-checked="true"]:not(:disabled)')||$('submit-mode-menu').querySelector('[role="menuitemradio"]:not(:disabled)');selected?.focus();}
  }
  function setSubmitMode(mode){
    const p=current();if(!p||state.running||!['local','official'].includes(mode))return;
    if(mode==='local'&&!localTestCount(p))return;
    state.submitModes.set(p.id,mode);setSubmitMenu(false);renderSubmitMode();$('submit-mode-button').focus();
  }
  function handleSubmitMenuKey(event){
    if(event.key==='Escape'){event.preventDefault();setSubmitMenu(false);$('submit-mode-button').focus();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();const options=[...$('submit-mode-menu').querySelectorAll('[role="menuitemradio"]:not(:disabled)')];
    if(!options.length)return;const index=options.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
    options[next].focus();
  }

  async function api(path, body) {
    const response = await fetch(`/api/${path}`, body === undefined ? {cache:'no-store'} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let value;
    try { value = await response.json(); } catch { throw new Error(`Сервер вернул ${response.status}. Проверь, что локальный сервер запущен.`); }
    if (!response.ok) {
      const error=new Error(typeof value.error === 'string' ? value.error : value.message || `Ошибка ${response.status}`);
      error.status=response.status;throw error;
    }
    return value;
  }
  let toastTimer;
  function toast(message, error=false) {
    $('toast').textContent = message;
    $('toast').classList.toggle('error',error);
    $('toast').hidden = false;
    clearTimeout(toastTimer);toastTimer = setTimeout(() => {$('toast').hidden=true;}, error ? 6500 : 3800);
  }
  function safeHTML(html) {
    const doc = new DOMParser().parseFromString(String(html || ''),'text/html');
    // KaTeX carries native MathML, TeX annotation and visual HTML copies. Native
    // MathML is the single rendering source after import strips KaTeX classes.
    for(const math of [...doc.body.querySelectorAll('math')]){
      math.querySelectorAll('annotation,annotation-xml').forEach((node)=>node.remove());
      const shell=math.parentElement,outer=shell?.parentElement;
      if(shell?.tagName==='SPAN'&&outer?.tagName==='SPAN'&&shell.children.length===1&&outer.firstElementChild===shell&&outer.children.length>=2&&[...outer.children].every((node)=>node.tagName==='SPAN')&&![...outer.childNodes].some((node)=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim()))outer.replaceChildren(math);
    }
    const allowed = new Set('P DIV SPAN BR STRONG B EM I U S SUB SUP PRE CODE UL OL LI H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TFOOT TR TD TH BLOCKQUOTE HR A IMG DL DT DD MATH SEMANTICS MROW MI MN MO MSUP MSUB MSUBSUP MUNDER MOVER MUNDEROVER MFRAC MSQRT MROOT MTEXT MTABLE MTR MTD MSTYLE MSPACE MMULTISCRIPTS MPRESCRIPTS NONE MPADDED MPHANTOM MFENCED'.split(' '));
    const mathAttributes=new Set('display mathvariant mathsize mathcolor displaystyle scriptlevel stretchy fence separator accent accentunder rowalign columnalign rowspacing columnspacing linethickness notation open close separators lspace rspace'.split(' '));
    for (const node of [...doc.body.querySelectorAll('*')]) {
      if (!allowed.has(node.tagName.toUpperCase())) { node.remove(); continue; }
      for (const attr of [...node.attributes]) {
        const goodLink = node.tagName === 'A' && attr.name === 'href' && /^https?:\/\//i.test(attr.value);
        const goodImage = node.tagName === 'IMG' && attr.name === 'src' && (/^https:\/\//i.test(attr.value)||/^\/imported\/statements\/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|gif|webp)$/.test(attr.value));
        const goodMath = node.namespaceURI==='http://www.w3.org/1998/Math/MathML'&&mathAttributes.has(attr.name);
        if (!goodLink && !goodImage && !goodMath && !['alt','colspan','rowspan'].includes(attr.name)) node.removeAttribute(attr.name);
      }
      if (node.tagName === 'A') {node.target='_blank';node.rel='noopener noreferrer';}
      if (node.tagName === 'IMG') {node.loading='lazy';node.referrerPolicy='no-referrer';}
    }
    return doc.body.innerHTML;
  }
  function codeValue() { return state.editor ? state.editor.getValue() : $('fallback-editor').value; }
  function saveSoon() {
    const p=current(); if (!p || state.changing) return;
    const d=draftOf(p);d.code=codeValue();d.notes=$('problem-notes').value;
    clearTimeout(state.saves.get(p.id));
    const saved=state.savedDrafts.get(p.id);
    if(saved&&d.code===saved.code&&d.notes===saved.notes){state.dirty.delete(p.id);$('save-status').textContent='Saved';return;}
    state.dirty.add(p.id);$('save-status').textContent='Saving…';
    const snapshot={problem_id:p.id,code:d.code,notes:d.notes};
    state.saves.set(p.id,setTimeout(() => saveDraft(snapshot),600));
  }
  async function saveDraft(snapshot) {
    const id=snapshot.problem_id;
    clearTimeout(state.saves.get(id));state.saves.delete(id);
    const active=state.draftWrites.get(id);if(active)return active;
    const writing=Promise.resolve().then(async()=>{
      let pending={...snapshot};
      while(pending){
        try{await api('draft',pending);}
        catch(error){state.dirty.add(id);if(state.currentId===id)$('save-status').textContent='Not saved';toast(error.message,true);break;}
        state.savedDrafts.set(id,{code:pending.code,notes:pending.notes});
        const local=state.data?.drafts[id];
        if(!local||(local.code===pending.code&&local.notes===pending.notes)){
          state.dirty.delete(id);clearTimeout(state.saves.get(id));state.saves.delete(id);
          if(state.currentId===id)$('save-status').textContent='Saved';break;
        }
        state.dirty.add(id);
        pending={problem_id:id,code:local.code,notes:local.notes};
      }
    }).finally(()=>{if(state.draftWrites.get(id)===writing)state.draftWrites.delete(id);});
    state.draftWrites.set(id,writing);return writing;
  }
  async function retryDirtyDrafts(){
    await Promise.all([...state.dirty].map(id=>{
      const draft=state.data?.drafts[id];if(!draft||state.draftWrites.has(id))return;
      return saveDraft({problem_id:id,code:draft.code,notes:draft.notes});
    }));
  }
  async function flushDraft() {
    const p=current();if(!p||!state.dirty.has(p.id))return;
    clearTimeout(state.saves.get(p.id));
    const d=draftOf(p);d.code=codeValue();d.notes=$('problem-notes').value;
    await saveDraft({problem_id:p.id,code:d.code,notes:d.notes});
  }
  function initEditor() {
    if (!window.require) { $('save-status').textContent='Текстовый редактор';return; }
    window.require.config({paths:{vs:'/vendor/monaco/vs'}});
    window.require(['vs/editor/editor.main'],() => {
      const initial=codeValue();
      monaco.editor.defineTheme('algo-graphite',{base:'vs-dark',inherit:true,rules:[],colors:{'editor.background':'#262626','editorLineNumber.foreground':'#6b6b6b','editorLineNumber.activeForeground':'#b6b6b6','editor.lineHighlightBackground':'#292929','editorGutter.background':'#262626','editor.selectionBackground':'#365473','scrollbarSlider.background':'#55555570'}});
      $('fallback-editor').hidden=true;
      state.editor=monaco.editor.create($('editor-host'),{value:initial,language:'python',theme:'algo-graphite',automaticLayout:true,fontFamily:'"SFMono-Regular", Consolas, "Liberation Mono", monospace',fontSize:14,lineHeight:21,minimap:{enabled:false},glyphMargin:true,lineNumbersMinChars:1,lineDecorationsWidth:3,scrollBeyondLastLine:false,renderLineHighlight:'line',padding:{top:7,bottom:16},tabSize:4,insertSpaces:true,wordWrap:'off',overviewRulerLanes:0,hideCursorInOverviewRuler:true,roundedSelection:false,bracketPairColorization:{enabled:true}});
      if(state.currentId)state.models.set(state.currentId,state.editor.getModel());
      state.decorations=state.editor.createDecorationsCollection([]);
      state.editor.onDidChangeModelContent(saveSoon);
      state.editor.onDidChangeCursorPosition((e) => {$('editor-position').textContent=`Ln ${e.position.lineNumber}, Col ${e.position.column}`;});
      state.editor.onMouseDown((e) => {if([monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS].includes(e.target.type)&&e.target.position) toggleBreakpoint(e.target.position.lineNumber);});
      state.editor.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.Enter,runCode);
      updateDecorations();
    },() => {$('save-status').textContent='Текстовый редактор';});
  }
  function toggleBreakpoint(line) {
    if(!current())return;
    const points=state.breakpoints.get(state.currentId)||new Set();
    points.has(line)?points.delete(line):points.add(line);
    state.breakpoints.set(state.currentId,points);updateDecorations();
  }
  function updateDecorations() {
    const points=[...(state.breakpoints.get(state.currentId)||[])];
    $('breakpoint-status').textContent=points.length?`Точки остановки: ${points.sort((a,b)=>a-b).join(', ')}`:'Точки остановки: клик слева от номера строки';
    if(!state.editor||!state.decorations)return;
    const decorations=points.map((line)=>({range:new monaco.Range(line,1,line,1),options:{isWholeLine:false,glyphMarginClassName:'breakpoint-glyph',glyphMarginHoverMessage:{value:`Точка остановки · строка ${line}`}}}));
    if(state.debug?.line&&state.debug.status==='paused')decorations.push({range:new monaco.Range(state.debug.line,1,state.debug.line,1),options:{isWholeLine:true,className:'current-line-highlight',glyphMarginClassName:'current-line-glyph'}});
    state.decorations.set(decorations);
    if(state.debug?.line&&state.debug.status==='paused')state.editor.revealLineInCenterIfOutsideViewport(state.debug.line);
  }
  function setEditorProblem(p) {
    const code=draftOf(p).code??defaultCode(p);
    if(!state.dirty.has(p.id))state.savedDrafts.set(p.id,{code,notes:draftOf(p).notes||''});
    state.changing=true;
    if(state.editor){
      if(state.currentId)state.viewStates.set(state.currentId,state.editor.saveViewState());
      let model=state.models.get(p.id);
      if(!model){model=monaco.editor.createModel(code,'python');state.models.set(p.id,model);}else if(!state.dirty.has(p.id)&&model.getValue()!==code)model.setValue(code);
      state.editor.setModel(model);const view=state.viewStates.get(p.id);if(view)state.editor.restoreViewState(view);
    }else $('fallback-editor').value=code;
    state.changing=false;
  }
  async function selectProblem(id,goToWorkspace=true) {
    const p=state.data?.problems.find((item)=>item.id===id);if(!p)return;
    if(current()&&state.currentId!==id){await flushDraft();if(state.debug&&['paused','running'].includes(state.debug.status)) await debugCommand('stop');}
    setEditorProblem(p);state.currentId=id;state.debug=null;state.customTest=false;
    try{localStorage.setItem('algo-current-problem',id);}catch{}
    $('debug-toolbar').hidden=true;$('problem-notes').value=draftOf(p).notes||'';
    $('assisted-checkbox').checked=!!draftOf(p).assisted;
    $('problem-status').value=statusOf(p);$('save-status').textContent=state.dirty.has(p.id)?'Not saved':'Saved';
    $('toolbar-problem').textContent=p.title;
    $('source-link').href=/^https?:\/\//.test(p.url||'')?p.url:'#';
    renderProblem();renderExamples();setSubmitMenu(false);if(state.lastResultKind.get(p.id)==='run'&&state.runResults.has(p.id))renderRunBatch(state.runResults.get(p.id));else if(state.judgeResults.has(p.id))renderJudgeResult(state.judgeResults.get(p.id),p);else{$('result-summary').className='result-summary muted';$('result-summary').textContent='Запусти код, чтобы увидеть результат.';$('result-body').innerHTML='';$('result-dot').hidden=true;}updateDecorations();
    if(goToWorkspace)switchView('workspace');
    updateRunButtons();
  }
  function renderProblem() {
    const p=current();
    if(!p){$('problem-heading').innerHTML='';$('description-content').innerHTML='<div class="empty-state"><h2>Твой следующий подход</h2><p>Выбери задачу из каталога или импортируй домашние контесты через Dia.</p><button class="button" data-view="catalog">Открыть задачи</button></div>';return;}
    const code=p.source==='leetcode'?`${p.externalId||''}. `:p.letter?`${p.letter}. `:'';
    $('problem-heading').innerHTML=`<h1 class="problem-title">${escape(code)}${escape(cleanTitle(p))}</h1><div class="problem-meta"><span class="badge ${difficulty(p).toLowerCase()}">${escape(difficulty(p))}</span><button class="badge text-button" data-show-topics>${icon('tag')}Topics</button><button class="badge text-button" data-description="theory">${icon('hint')}Hint</button>${p.source==='yandex'?`<span class="badge source">ФКН · ${escape(p.contestId||'')}</span>`:''}${statusOf(p)==='review'?'<span class="badge review">Повторить</span>':isSolved(p)?'<span class="badge solved">Solved</span>':''}${p.previously_solved&&!isSolved(p)?'<span class="badge previous">Решал раньше</span>':''}${!priorityOf(p)?'<span class="badge optional">Дополнительно</span>':''}${p.premium?'<span class="badge">Premium</span>':''}</div><div id="problem-topic-list" class="problem-topic-list" hidden>${topicIds(p).map((id)=>`<button class="badge text-button" data-topic="${escape(id)}">${escape(topicOf(id)?.title||id)}</button>`).join('')}</div>`;

    let statement=p.statement_html||'';
    if(statement&&p.source==='yandex'){
      const document=new DOMParser().parseFromString(statement,'text/html'),header=document.body.firstElementChild;
      if(header?.tagName==='DIV'&&header.querySelector(':scope > h1')){
        header.querySelector(':scope > h1').remove();header.querySelectorAll(':scope > span').forEach((node)=>node.remove());
      }
      statement=document.body.innerHTML;
    }
    let content=statement?safeHTML(statement):`<div class="import-placeholder"><p>Условие ещё не импортировано.</p><p class="muted">Открой задачу через Dia и подключи расширение. Условия и примеры останутся на этом Mac.</p><button class="button tiny" data-connect>Подключение и импорт</button></div>`;
    if(p.examples?.length&&!/(пример|example)\s*\d?\s*[:<]/i.test(p.statement_html||''))content+=p.examples.map((example,i)=>`<section class="problem-example"><h3>Пример ${i+1}</h3><div class="example-block"><div><strong>Ввод</strong><pre>${escape(inputValue(example.input))}</pre></div><div><strong>Вывод</strong><pre>${escape(inputValue(example.output))}</pre></div></div></section>`).join('');
    const alternatives=(p.alternative_judges||[]).filter((item)=>item.match==='verified'&&/^https:\/\//.test(item.url||''));
    if(alternatives.length)content=`<details class="alternative-judges small"><summary>Та же задача на другой площадке · ${alternatives.length}</summary>${alternatives.map((item)=>`<p><a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.title)}</a>${item.differences?`<br><span class="muted">${escape(item.differences)}</span>`:''}</p>`).join('')}<p class="muted">Условие и формат сверены. Доступные языки и возможность отправки зависят от площадки.</p></details>`+content;
    if(p.statement_incomplete===true)content=`<p class="muted small" role="note">${escape(p.statement_import_note||'Условие импортировано неполностью. Нужна сверка с источником.')}</p>`+content;
    $('description-content').innerHTML=content;
    renderTheory();renderSubmissions();setDescriptionTab(state.description);
  }
  function sourceLinks(topic){const links=(topic.sources||[]).filter((s)=>/^(https:\/\/|\/reference\/)/.test(s.url||''));return links.length?`<div class="theory-sources">${links.map((s)=>`<a href="${escape(s.url)}" target="_blank" rel="noopener noreferrer">${escape(s.title)}</a>`).join(' · ')}</div>`:'';}
  function renderTheory() {
    const p=current();if(!p)return;
    let topics=topicIds(p).map(topicOf).filter(Boolean);
    if(!topics.length){$('theory-content').innerHTML='<div class="empty-state">Тема ещё не определена. Можно обсудить общий подход к этой задаче.</div>'+promptActions(p);return;}
    $('theory-content').innerHTML=topics.map((t)=>`<section class="theory-topic"><h2>${escape(t.title)}</h2><p class="theory-intro">${escape(t.summary||'Вспомни основные идеи перед решением.')}</p>${t.cheatsheet?.length?`<ul>${t.cheatsheet.map((line)=>`<li>${escape(line)}</li>`).join('')}</ul>`:''}${sourceLinks(t)}<div class="theory-actions"><button class="button" data-copy-prompt="${escape(t.id)}">Скопировать запрос для GPT</button><a class="button ghost" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Открыть ChatGPT ↗</a></div></section>`).join('')+'<p class="muted small" style="margin-top:18px">Запрос просит объяснить тему без готового решения. Вставь его в свой чат.</p>';
  }
  function promptActions(){return '<div class="theory-actions"><button class="button" data-copy-prompt="">Скопировать запрос для GPT</button><a class="button ghost" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Открыть ChatGPT ↗</a></div>';}
  function inputValue(value){return typeof value==='string'?value:JSON.stringify(value??'',null,2);}
  function casesFor(problem=current()) {
    if(!problem)return [];
    if(!state.testCases.has(problem.id)){
      const cases=(problem.examples||[]).map((example,index)=>({id:String(index),label:`Case ${index+1}`,input:inputValue(example.input),expected:example.output===undefined?'':inputValue(example.output)}));
      if(!cases.length)cases.push({id:'0',label:'Case 1',input:'',expected:'',custom:true});
      state.testCases.set(problem.id,cases);state.testSelections.set(problem.id,cases[0].id);
    }
    return state.testCases.get(problem.id);
  }
  function captureSelectedTest() {
    const p=current();if(!p)return;
    const selected=casesFor(p).find(item=>item.id===state.testSelections.get(p.id));if(!selected)return;
    selected.input=$('stdin-input').value;selected.expected=$('expected-output').value;
  }
  function renderTestChips() {
    const p=current();if(!p)return;
    const selected=state.testSelections.get(p.id);
    $('test-cases').innerHTML=casesFor(p).map(item=>`<button class="test-chip ${item.id===selected?'active':''}" data-example="${escape(item.id)}" role="tab" tabindex="${item.id===selected?0:-1}" aria-selected="${item.id===selected}">${escape(item.label)}</button>`).join('')+`<button class="test-chip add-test-case" data-add-test aria-label="Добавить свой тест" title="Добавить свой тест">${icon('plus')}</button>`;
  }
  function showSelectedTest() {
    const p=current(),cases=casesFor(p);if(!p)return;
    const selected=cases.find(item=>item.id===state.testSelections.get(p.id))||cases[0];
    state.testSelections.set(p.id,selected.id);state.customTest=!!selected.custom;
    $('stdin-input').value=selected.input;$('expected-output').value=selected.expected;
    renderTestChips();renderArgumentFields();
  }
  function addTestCase(input=$('stdin-input').value,expected=$('expected-output').value) {
    const p=current();if(!p)return;
    captureSelectedTest();const cases=casesFor(p);
    if(cases.length>=30){toast('Можно добавить до 30 примеров за один запуск.');return;}
    const item={id:String(cases.length),label:`Case ${cases.length+1}`,input,expected,custom:true};
    cases.push(item);state.testSelections.set(p.id,item.id);showSelectedTest();
  }
  function renderExamples() {
    const p=current();if(!p)return;casesFor(p);showSelectedTest();
    const lc=p.source==='leetcode';$('input-label').textContent=lc?'Input =':'stdin =';
    $('stdin-input').placeholder=lc?'Например: {"nums": [2, 7], "target": 9}':'Входные данные';
    $('test-note').textContent=`Run проверяет все добавленные примеры. Debug — выбранный пример.${localTestCount(p)?' Submit запускает локальный набор: '+localTestCount(p)+' тестов.':''}`;
  }
  function splitArguments(text) {
    const parts=[];let start=0,depth=0,quote='',escaped=false;
    for(let i=0;i<text.length;i++){
      const char=text[i];
      if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if('[{('.includes(char))depth++;else if(']})'.includes(char))depth--;
      else if(depth===0&&(char===','||char==='\n')){const part=text.slice(start,i).trim();if(part)parts.push(part);start=i+1;}
    }
    const last=text.slice(start).trim();if(last)parts.push(last);return parts;
  }
  function inputArguments(problem,input) {
    const params=(problem?.signature?.params||[]).map(param=>typeof param==='string'?param:param.name).filter(Boolean);
    if(problem?.source!=='leetcode'||!params.length)return null;
    let values=null;
    try{const json=JSON.parse(input);if(json&&typeof json==='object'&&!Array.isArray(json)&&params.every(name=>name in json))values=params.map(name=>JSON.stringify(json[name]));else if(params.length===1)values=[JSON.stringify(json)];}catch{}
    if(!values){const parts=splitArguments(input),named={};for(const part of parts){const match=part.match(/^([A-Za-z_]\w*)\s*=\s*([\s\S]*)$/);if(match)named[match[1]]=match[2];}if(params.every(name=>name in named))values=params.map(name=>named[name]);else if(parts.length===params.length&&!parts.some(part=>/^\w+\s*=/.test(part)))values=parts;}
    if(!values&&!input.trim())values=params.map(()=> '');
    return values?params.map((name,index)=>({name,value:values[index]})):null;
  }
  function renderArgumentFields() {
    const values=inputArguments(current(),$('stdin-input').value);
    $('stdin-wrapper').hidden=!!values;
    $('argument-fields').innerHTML=values?values.map(item=>`<label class="field-label"><span>${escape(item.name)} =</span><textarea class="code-input argument-input" data-argument="${escape(item.name)}" aria-label="${escape(item.name)}" spellcheck="false" rows="1">${escape(item.value)}</textarea></label>`).join(''):'';
  }
  function syncArgumentFields(){const fields=[...$('argument-fields').querySelectorAll('[data-argument]')];$('stdin-input').value=fields.map(field=>`${field.dataset.argument} = ${field.value}`).join('\n');captureSelectedTest();}
  function selectExample(index) {
    if(index==='custom'){addTestCase();return;}
    captureSelectedTest();const p=current();if(!p||!casesFor(p).some(item=>item.id===String(index)))return;
    state.testSelections.set(p.id,String(index));showSelectedTest();
  }
  function caseTabsKey(event){
    const button=event.target.closest('[role="tab"]');if(!button||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const group=button.parentElement,tabs=[...group.querySelectorAll('[role="tab"]')];if(!tabs.length)return;
    event.preventDefault();const index=tabs.indexOf(button),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    if(tabs[next].dataset.resultCase!==undefined)selectResultCase(Number(tabs[next].dataset.resultCase));else selectExample(tabs[next].dataset.example);
    const selector=tabs[next].dataset.resultCase!==undefined?'[data-result-case]':'[data-example]';const liveGroup=selector==='[data-result-case]'?$('result-body').querySelector('.result-cases'):$('test-cases');liveGroup.querySelectorAll(selector)[next]?.focus();
  }
  function briefBridgeMessage(value){
    if(value&&typeof value==='object')return 'Технические подробности сохранены локально.';
    const text=String(value||'').replace(/\s+/g,' ').trim();
    if((text.startsWith('{')||text.startsWith('['))&&text.length>120){try{JSON.parse(text);return 'Технические подробности сохранены локально.';}catch{}}
    return text.length>260?text.slice(0,257)+'…':text;
  }
  function officialVerdictTone(job){
    if(job.dry_run)return '';
    if(/^(ok|accepted)$/i.test(String(job.verdict||'').trim()))return 'accepted';
    return job.status==='error'||/wrong answer|runtime error|compilation error|presentation error|limit exceeded|security violation|^(wa|re|ce|pe|tl|ml|ol|sv)$/i.test(String(job.verdict||'').trim())?'failed':'';
  }
  function renderSubmissions(){
    const p=current();if(!p)return;
    const jobs=Array.isArray(state.bridge?.jobs)?state.bridge.jobs:Object.values(state.bridge?.jobs||{});
    const submissions=jobs.filter((j)=>j.action==='submit'&&(j.problem_id===p.id||j.problem?.id===p.id));
    $('submissions-content').innerHTML=submissions.length?submissions.slice().reverse().map((j)=>{
      const dry=!!j.dry_run;
      const status=dry?'Проверка интеграции · без отправки':briefBridgeMessage(j.verdict||j.message||j.status);
      const details=dry?({complete:'Завершено',error:'Ошибка',running:'Выполняется',queued:'В очереди'})[j.status]||j.status:`Python3 · ${j.run_id||''}`;
      const tone=officialVerdictTone(j);
      return `<div class="submission-row"><div class="submission-status ${tone}">${escape(status)}</div><div class="submission-meta">${escape(details)} ${j.created_at?new Date(epoch(j.created_at)).toLocaleString('ru-RU'):''}</div></div>`;
    }).join(''):'<div class="empty-state">Здесь появятся новые отправки из локального редактора. Старые посылки доступны в источнике задачи.</div>';
  }

  function setDescriptionTab(name){state.description=name;document.querySelectorAll('[data-description]').forEach((b)=>{b.classList.toggle('active',b.dataset.description===name);b.setAttribute('aria-selected',b.dataset.description===name);});for(const tab of ['description','theory','notes','submissions'])$(`${tab}-content`).hidden=tab!==name;}
  function expandConsole(open=true){state.consoleCollapsed=!open;$('coding-column').style.setProperty('--console',open?(innerWidth<=850?'310px':'38%'):'36px');$('toggle-console').setAttribute('aria-label',open?'Свернуть тестовую панель':'Развернуть тестовую панель');$('toggle-console').title=open?'Свернуть тестовую панель':'Развернуть тестовую панель';$('toggle-console').innerHTML=icon(open?'down':'up');requestAnimationFrame(()=>state.editor?.layout());}
  function setConsoleTab(name){state.console=name;document.querySelectorAll('[data-console]').forEach((b)=>{b.classList.toggle('active',b.dataset.console===name);b.setAttribute('aria-selected',b.dataset.console===name);});for(const item of ['tests','result','debug'])$(`${item}-content`).hidden=item!==name;document.body.classList.remove('editor-maximized');expandConsole(true);}

  function switchView(view){if(!['workspace','catalog','map','interview'].includes(view))return;state.view=view;document.querySelectorAll('.view').forEach((el)=>el.hidden=el.id!==`${view}-view`);document.querySelectorAll('.main-nav [data-view]').forEach((el)=>el.classList.toggle('active',el.dataset.view===view));if(view==='catalog')renderCatalog();if(view==='map')renderMap();if(view==='interview')renderInterview();if(view==='workspace')requestAnimationFrame(()=>state.editor?.layout());try{history.replaceState(null,'',`#${view}`);}catch{} }
  function updateRunButtons(){for(const id of ['run-button','debug-button','submit-button','submit-mode-button'])$(id).disabled=!current()||state.running;renderSubmitMode();}
  async function runCode(){
    const p=current();if(!p||state.running)return;
    captureSelectedTest();
    const problemId=p.id,code=codeValue();
    const batch={problem:{...p},cases:casesFor(p).map(item=>({...item,result:null})),selected:0,complete:false,diff:true};
    state.runResults.set(problemId,batch);state.lastResultKind.set(problemId,'run');
    state.running=true;updateRunButtons();$('execution-label').textContent='Run · примеры';setConsoleTab('result');renderRunBatch(batch);
    try{
      await flushDraft();
      for(let index=0;index<batch.cases.length;index++){
        const item=batch.cases[index],body={problem_id:problemId,code,stdin:item.input};
        if(item.expected!=='')body.expected=item.expected;
        try{item.result=await api('run',body);}catch(error){item.result={status:'error',stderr:error.message};}
        if(state.currentId===problemId){$('execution-label').textContent=`Run · ${index+1} / ${batch.cases.length}`;renderRunBatch(batch);}
      }
    }catch(error){
      const pending=batch.cases.find(item=>!item.result);if(pending)pending.result={status:'error',stderr:error.message};
    }finally{
      batch.complete=true;const failure=batch.cases.findIndex(item=>caseVerdict(item.result).tone==='error');
      batch.selected=failure>=0?failure:0;
      if(state.currentId===problemId)renderRunBatch(batch);else toast(`Запуск «${p.title}» завершён.`);
      state.running=false;updateRunButtons();$('execution-label').textContent='';
    }
  }
  function renderResult(result,expectedOutput=$('expected-output').value,context={}){
    const verdict=context.verdict||caseVerdict(result),batch=context.batch,item=context.item;
    $('result-summary').className=`result-summary ${verdict.tone}`;
    $('result-summary').dataset.source='run';$('result-summary').dataset.verdict=verdict.label;
    const duration=batch?batch.cases.reduce((sum,value)=>sum+(Number(value.result?.duration)||0),0):result?.duration;
    const canDiff=caseVerdict(result).label==='Wrong Answer'&&expectedOutput!=='';
    $('result-summary').innerHTML=`<span>${escape(verdict.label)}</span>${Number.isFinite(duration)?`<span class="result-meta">Runtime: ${Math.round(duration*1000)} ms</span>`:''}${canDiff&&batch?`<button class="result-diff-toggle" data-result-diff aria-pressed="${batch.diff!==false}">Diff</button>`:''}`;
    $('result-dot').hidden=false;$('result-dot').classList.toggle('error',verdict.tone==='error');$('result-dot').classList.toggle('manual',verdict.tone==='muted');
    let content=batch?`<div class="result-cases" role="tablist" aria-label="Результаты примеров">${batch.cases.map((value,index)=>`<button class="result-case ${index===batch.selected?'active':''}" data-result-case="${index}" role="tab" tabindex="${index===batch.selected?0:-1}" aria-selected="${index===batch.selected}" aria-label="${escape(value.label+' · '+caseVerdict(value.result).label)}">${caseStatusIcon(value.result)}<span>${escape(value.label)}</span></button>`).join('')}</div>`:'';
    if(item){const values=inputArguments(batch.problem,item.input);content+=`<section class="result-section result-input"><h3>Input</h3>${values?values.map(value=>`<div class="result-input-card"><span class="result-argument-name">${escape(value.name)} =</span><pre>${escape(resultText(value.value))}</pre></div>`).join(''):`<pre>${escape(resultText(item.input,false))}</pre>`}</section>`;}
    if(!result){content+='<p class="result-pending">Ожидает запуска…</p>';$('result-body').innerHTML=content;return;}
    const hasReturn=Object.prototype.hasOwnProperty.call(result,'return_value');
    const output=hasReturn?JSON.stringify(result.return_value):(result.stdout||'');
    const compared=canDiff&&(!batch||batch.diff!==false);
    content+=(result.comparison_message?`<p class="comparison-note">${escape(result.comparison_message)}</p>`:'')+resultSection('Output',output,{diff:compared,other:expectedOutput,tone:'actual'});
    if(expectedOutput!=='')content+=resultSection('Expected',expectedOutput,{diff:compared,other:output,tone:'expected'});
    if(result.mutated_prefix!==undefined)content+=resultSection('Modified input',JSON.stringify(result.mutated_prefix));
    let extraStdout=false;
    if(hasReturn&&result.stdout?.trim()){try{extraStdout=JSON.stringify(JSON.parse(result.stdout))!==JSON.stringify(result.return_value);}catch{extraStdout=true;}}
    if(extraStdout)content+=resultSection('Stdout',result.stdout,{compact:false});
    if(result.stderr)content+=resultSection('stderr',result.stderr,{compact:false,error:true});
    if(result.error&&!String(result.stderr||'').includes(String(result.error)))content+=resultSection('Ошибка',result.error,{compact:false,error:true});
    if(batch)content+=`<p class="run-provenance">Run · локальные примеры: ${batch.cases.length}</p>`;
    $('result-body').innerHTML=content;
  }
  function resultText(value,compact=true){
    let text=typeof value==='string'?value:JSON.stringify(value);
    if(text===undefined)text='';
    if(compact){try{text=JSON.stringify(JSON.parse(text));}catch{}}
    return text.length>12000?text.slice(0,12000)+'\n…':text;
  }
  function diffMarkup(value,other,tone){
    const text=resultText(value),reference=resultText(other);
    const tokens=text.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|\s+|./gu)||[];
    const compared=reference.match(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|\s+|./gu)||[];
    return tokens.map((token,index)=>token!==compared[index]&&!/^[\s[\]{},:]+$/.test(token)?`<span class="result-diff-${tone}">${escape(token)}</span>`:escape(token)).join('');
  }
  function resultSection(title,value,options={}){
    const text=resultText(value,options.compact!==false);
    return `<section class="result-section${options.error?' result-error-section':''}"><h3>${escape(title)}</h3><pre>${options.diff?diffMarkup(value,options.other,options.tone):escape(text)}</pre></section>`;
  }
  function caseVerdict(result){
    if(!result)return {label:'Pending',tone:'muted'};
    const ok=Number.isFinite(result.exit_code)?result.exit_code===0:['success','finished','ok'].includes(result.status);
    if(!ok)return {label:result.status==='timeout'?'Time Limit Exceeded':'Runtime Error',tone:'error'};
    if(result.passed===false)return {label:'Wrong Answer',tone:'error'};
    if(result.comparison==='manual')return {label:'Needs Review',tone:'muted'};
    if(result.passed===true)return {label:'Accepted',tone:'success'};
    return {label:'Finished',tone:'muted'};
  }
  function caseStatusIcon(result){
    const verdict=caseVerdict(result);
    if(verdict.tone==='muted')return `<svg class="case-status pending" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
    return `<svg class="case-status ${verdict.tone}" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="2" fill="currentColor"/><path d="${verdict.tone==='success'?'M4.5 8l2.2 2.2 4.8-5':'M5.5 5.5l5 5m0-5l-5 5'}" fill="none" stroke="#262626" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function renderRunBatch(batch){
    const results=batch.cases.map(item=>caseVerdict(item.result));
    const verdict=!batch.complete?{label:'Running…',tone:'muted'}:results.find(value=>value.tone==='error')||results.find(value=>value.tone==='muted')||{label:'Accepted',tone:'success'};
    const item=batch.cases[batch.selected]||batch.cases[0];
    renderResult(item.result,item.expected,{batch,item,verdict});
  }
  function selectResultCase(index){const batch=state.runResults.get(state.currentId);if(!batch||!batch.cases[index])return;batch.selected=index;renderRunBatch(batch);}
  function toggleResultDiff(){const batch=state.runResults.get(state.currentId);if(!batch)return;batch.diff=batch.diff===false;renderRunBatch(batch);}

  async function judgeLocal(){
    const p=current(),count=localTestCount(p);if(!p||state.running)return;
    if(!count){toast('Для этой задачи пока нет локального набора тестов.');return;}
    const code=codeValue();
    state.running=true;updateRunButtons();setConsoleTab('result');
    $('execution-label').textContent='Локальная проверка…';$('result-summary').className='result-summary muted';
    $('result-summary').textContent=`LOCAL · Проверяем ${count} тестов…`;$('result-body').innerHTML='';$('result-dot').hidden=true;
    try{
      await flushDraft();
      const result=await api('judge',{problem_id:p.id,code});state.judgeResults.set(p.id,result);state.lastResultKind.set(p.id,'judge');
      if(state.currentId===p.id)renderJudgeResult(result,p);else toast(`LOCAL · ${p.title}: ${result.passed_count} / ${result.total} тестов.`);
    }catch(error){
      const result={source:'local',official:false,verdict:'ERROR',passed_count:0,total:count,attempted_count:0,first_failure:{error:error.message}};
      state.judgeResults.set(p.id,result);state.lastResultKind.set(p.id,'judge');if(state.currentId===p.id)renderJudgeResult(result,p);else toast(error.message,true);
    }finally{state.running=false;updateRunButtons();$('execution-label').textContent='';}
  }
  function renderJudgeResult(result,problem=current()){
    const total=Number(result.total)||localTestCount(problem),passed=Number(result.passed_count)||0;
    const attempted=Number.isFinite(result.attempted_count)?result.attempted_count:total;
    const ok=result.verdict==='LOCAL_OK'&&total>0&&passed===total&&attempted>=total;
    const reason=({WRONG_ANSWER:'Wrong Answer',RUNTIME_ERROR:'Runtime Error',TIME_LIMIT:'Time Limit Exceeded',TOTAL_TIME_LIMIT:'Time Limit Exceeded',ERROR:'Check Failed'})[result.verdict]||'Incomplete';
    $('result-summary').className=`result-summary ${ok?'success':'error'}`;
    $('result-summary').innerHTML=`<span>LOCAL · ${ok?'Accepted':reason}</span>${Number.isFinite(result.duration_ms)?`<span class="result-meta">Runtime: ${Math.round(result.duration_ms)} ms</span>`:''}`;
    $('result-summary').dataset.source='local';$('result-summary').dataset.verdict=result.verdict||'';
    $('result-dot').hidden=false;$('result-dot').classList.toggle('error',!ok);$('result-dot').classList.remove('manual');
    const failure=result.first_failure;
    let content=`<p class="local-judge-note">${passed} / ${total} тестов · локальный набор. Статус задачи отмечается вручную.${attempted<total?` Проверено ${attempted} из ${total}; набор не завершён.`:''}</p>`;
    if(ok&&problem&&!isSolved(problem))content+=`<div class="theory-actions"><button class="button tiny" data-complete-local="${escape(problem.id)}">Засчитать в прогресс</button></div>`;
    if(failure){
      const diff=result.verdict==='WRONG_ANSWER'&&failure.expected!==undefined;
      if(failure.case_index)content+=`<div class="result-cases"><span class="result-case active">${caseStatusIcon({status:'error'})}<span>Case ${escape(failure.case_index)}</span></span></div>`;
      if(failure.input!==undefined)content+=resultSection('Input',failure.input,{compact:false});
      if(failure.actual!==undefined)content+=resultSection('Output',failure.actual,{diff,other:failure.expected,tone:'actual'});
      if(failure.expected!==undefined)content+=resultSection('Expected',failure.expected,{diff,other:failure.actual,tone:'expected'});
      if(failure.stderr)content+=resultSection('stderr',failure.stderr,{compact:false,error:true});
      if(failure.error&&!String(failure.stderr||'').includes(String(failure.error)))content+=resultSection('Ошибка',failure.error,{compact:false,error:true});
      if(failure.input!==undefined&&problem)content+=`<div class="theory-actions"><button class="button tiny" data-load-judge-failure="${escape(problem.id)}">Открыть тест для отладки</button></div>`;
      if(String(failure.input||'').length>12000)content+='<p class="muted small">Показан фрагмент ввода. Полный ввод доступен по кнопке «Открыть тест для отладки».</p>';
    }
    content+=problem?testProvenanceDetails({...problem,local_test_count:total,local_test_provenance:result.provenance||problem.local_test_provenance}):'';$('result-body').innerHTML=content;
  }
  async function loadJudgeFailure(id){
    const failure=state.judgeResults.get(id)?.first_failure;if(!failure||failure.input===undefined)return;
    if(state.currentId!==id)await selectProblem(id);
    addTestCase(typeof failure.input==='string'?failure.input:JSON.stringify(failure.input),failure.expected===undefined?'':typeof failure.expected==='string'?failure.expected:JSON.stringify(failure.expected));
    setConsoleTab('tests');toast('Падающий тест открыт для Run и Debug.');
  }
  function debugIsCurrent(sessionId,problemId){return state.currentId===problemId&&state.debug?.session_id===sessionId;}
  async function startDebug(){
    const p=current();if(!p||state.running)return;
    const problemId=p.id,config={problem_id:p.id,code:codeValue(),stdin:$('stdin-input').value,breakpoints:[...(state.breakpoints.get(p.id)||[])]};
    state.running=true;updateRunButtons();clearTimeout(state.debugTimer);
    try{
      const previous=state.debug?.session_id;
      if(previous){
        try{await api(`debug/${encodeURIComponent(previous)}/command`,{command:'stop'});}catch(error){if(error.status!==404)throw error;}
        if(state.debug?.session_id===previous)state.debug=null;
      }
      if(state.currentId!==problemId)return;
      await flushDraft();if(state.currentId!==problemId)return;
      const session=await api('debug/start',config);
      if(state.currentId!==problemId){await api(`debug/${encodeURIComponent(session.session_id)}/command`,{command:'stop'});return;}
      state.debug=session;setConsoleTab('debug');renderDebug();pollDebug();
    }catch(error){toast(`${p.title}: ${error.message}`,true);}
    finally{state.running=false;updateRunButtons();}
  }
  async function debugCommand(command){
    const sessionId=state.debug?.session_id,problemId=state.currentId;if(!sessionId)return;
    try{
      const result=await api(`debug/${encodeURIComponent(sessionId)}/command`,{command,breakpoints:[...(state.breakpoints.get(problemId)||[])]});
      if(!debugIsCurrent(sessionId,problemId))return;
      state.debug=result;renderDebug();pollDebug();
    }catch(error){
      if(!debugIsCurrent(sessionId,problemId))return;
      state.debug={...state.debug,status:'error',line:null,error:error.message};renderDebug();toast(error.message,true);
    }
  }
  function pollDebug(){
    clearTimeout(state.debugTimer);if(state.debug?.status!=='running')return;
    const sessionId=state.debug.session_id,problemId=state.currentId;
    state.debugTimer=setTimeout(async()=>{
      if(!debugIsCurrent(sessionId,problemId))return;
      try{
        const result=await api(`debug/${encodeURIComponent(sessionId)}`);
        if(!debugIsCurrent(sessionId,problemId))return;
        state.debug=result;renderDebug();pollDebug();
      }catch(error){
        if(!debugIsCurrent(sessionId,problemId))return;
        state.debug={...state.debug,status:'error',line:null,error:error.message};renderDebug();toast(error.message,true);
      }
    },250);
  }
  function renderDebug(){const d=state.debug;if(!d)return;$('debug-toolbar').hidden=false;const labels={paused:`Пауза${d.line?' · строка '+d.line:''}`,running:'Выполняется…',finished:'Завершено',error:'Ошибка'};$('debug-state').textContent=labels[d.status]||d.status;document.querySelectorAll('[data-debug]').forEach((b)=>b.disabled=b.dataset.debug==='stop'?!['running','paused'].includes(d.status):d.status!=='paused');const locals=Array.isArray(d.locals)?d.locals:Object.entries(d.locals||{}).map(([name,value])=>({name,value,type:''}));$('debug-variables').innerHTML=locals.length?`<table class="variables-table"><tbody>${locals.map((v)=>`<tr><td>${escape(v.name)}</td><td>${escape(v.value)}</td><td>${escape(v.type)}</td></tr>`).join('')}</tbody></table>`:'<span class="muted small">Нет локальных переменных.</span>';$('debug-stack').innerHTML=(d.stack||[]).map((f)=>`<div class="stack-frame">${escape(f.name)}<span>:${escape(f.line)}</span></div>`).join('')||'<span class="muted small">Стек пуст.</span>';$('debug-output').textContent=(d.stdout||'')+(d.stderr?'\n'+d.stderr:'')+(d.error?'\n'+d.error:'');updateDecorations();}
  async function submitCode(){const p=current();if(!p||state.running)return;const code=codeValue();setSubmitMenu(false);if(submitModeFor(p)==='local'){await judgeLocal();return;}if(state.bridge?.paused){toast('Dia на паузе. Отправка отключена, локальные Run и Debug доступны.');return;}if(!state.bridge?.connected){openConnection();toast('Для отправки подключи расширение Dia.');return;}try{await flushDraft();const result=await api('bridge/queue',{action:'submit',problem_id:p.id,code});state.knownJobs.set(result.job_id,'queued');toast('Код передан в Dia. Ожидаем официальный вердикт.');refreshBridge();}catch(error){toast(error.message,true);}}
  async function setProgress(status){const p=current();if(!p)return;try{const result=await api('progress',{problem_id:p.id,status,assisted:$('assisted-checkbox').checked});draftOf(p).status=status;draftOf(p).assisted=$('assisted-checkbox').checked;p.solved=status==='solved'||status==='review'&&p.solved;if(result.progress)state.data.progress=result.progress;else if(result.solved!==undefined)state.data.progress=result;renderProblem();renderProgress();await loadData(false);}catch(error){toast(error.message,true);$('problem-status').value=statusOf(p);}}
  function renderProgress(){const progress=state.data.progress||{};const solved=progress.solved??state.data.problems.filter(isSolved).length;const target=progress.target||200;$('goal-count').textContent=`${solved} / ${target}`;$('interview-progress').innerHTML=`${solved} <span>/ ${target}</span>`;$('goal-bar').style.width=`${Math.min(100,solved/target*100)}%`;const remaining=Math.max(0,target-solved);let days=progress.days_left;if(!Number.isFinite(days)){const today=new Date(new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Moscow'}));days=Math.max(0,Math.ceil((new Date('2027-03-16')-today)/86400000));}const rate=days?remaining/days:remaining;$('interview-plan-text').innerHTML=remaining?`Осталось <strong>${remaining}</strong> задач до 16 марта.<br>${days} дней · примерно ${rate.toLocaleString('ru-RU',{maximumFractionDigits:2})} задачи в день.`:'Цель достигнута. Можно продолжать решать и повторять.';}
  function filters(){return{q:$('search-input').value.trim().toLowerCase(),source:$('source-filter').value,topic:$('topic-filter').value,diff:$('difficulty-filter').value,status:$('status-filter').value};}
  function renderCatalog(){if(!state.data)return;const f=filters();const all=state.data.problems;const list=all.filter((p)=>(!f.q||`${p.title} ${p.externalId||''} ${p.contestId||''}`.toLowerCase().includes(f.q))&&(!f.source||p.source===f.source)&&(!f.topic||topicIds(p).includes(f.topic))&&(!f.diff||(p.difficulty||'Unknown')===f.diff)&&(!f.status||statusOf(p)===f.status));$('problem-table-body').innerHTML=list.length?list.map((p)=>`<tr><td><span class="status-icon ${statusOf(p)}" title="${({solved:'Решена',review:'Повторить',todo:'Не решена'})[statusOf(p)]}">${statusSymbol(p)}</span></td><td><button class="problem-title-button" data-problem="${escape(p.id)}">${escape(p.source==='leetcode'&&p.externalId?p.externalId+'. ':p.letter?p.letter+'. ':'')}${escape(cleanTitle(p))}${p.statement_incomplete===true?'<span class="optional-label">Неполное условие</span>':''}${!priorityOf(p)?'<span class="optional-label">Дополнительно</span>':''}${p.premium?'<span class="premium-mark" title="Требуется Premium">♙</span>':''}${!p.imported?'<span class="import-dot" title="Условие ещё не импортировано"></span>':''}</button></td><td>${topicIds(p).slice(0,2).map((id)=>`<span class="table-topic">${escape(topicOf(id)?.title||id)}</span>`).join('')}</td><td><span class="difficulty ${difficulty(p).toLowerCase()}">${escape(difficulty(p))}</span></td><td><span class="problem-source">${escape(sourceName(p))}</span></td></tr>`).join(''):'<tr class="no-problems-row"><td colspan="5">По этим фильтрам задач нет.</td></tr>';$('catalog-shown').textContent=`Показано ${list.length} из ${all.length} задач`;const imported=all.filter((p)=>p.imported&&!p.statement_incomplete).length;const incomplete=all.filter((p)=>p.statement_incomplete===true).length;const complete=state.data.contests.filter((c)=>c.import_status==='complete').length;$('catalog-summary').textContent=`${all.length} задач · ${imported} с условиями${incomplete?' · '+incomplete+' неполных':''} · ${complete} / ${state.data.contests.length} контестов импортировано`;const pending=state.data.contests.length-complete;$('import-notice').hidden=!pending;if(pending)$('import-notice').innerHTML=`<span><strong>${pending} контестов ждут импорта из Dia.</strong> Каталог пополнится всеми задачами домашних работ.</span><button class="button tiny" data-connect>Подключить импорт</button>`;$('contests-summary').textContent=`Домашние контесты · ${complete} / ${state.data.contests.length}`;$('contests-list').innerHTML=state.data.contests.map((c)=>`<div class="contests-list-row"><a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">${escape(c.title)}</a><span class="muted">${escape(c.course||'')}${c.interview_priority===false?' · дополнительно':''}</span><span class="import-state ${escape(c.import_status||'pending')}">${({complete:'✓ Импортирован',pending:'Ожидает',error:'Ошибка'})[c.import_status]||'Ожидает'}</span></div>`).join('');}
  function topicProblems(id){return state.data.problems.filter((p)=>topicIds(p).includes(id));}
  let mapObserver,mapFrame;
  function scheduleMapEdges(){cancelAnimationFrame(mapFrame);mapFrame=requestAnimationFrame(drawMapEdges);}
  function renderMap(){
    if(!state.data)return;
    const topics=[...state.data.topics].sort((a,b)=>(a.order||0)-(b.order||0));
    if(!state.selectedTopic&&topics.length)state.selectedTopic=topics[0].id;
    const selected=topicOf(state.selectedTopic);
    const parents=new Set(selected?.prerequisites||[]);
    const children=new Set(topics.filter((t)=>(t.prerequisites||[]).includes(state.selectedTopic)).map((t)=>t.id));
    $('topic-map').innerHTML='<svg class="topic-connectors" role="img" aria-label="Связи тем: стрелки ведут от основы к следующей теме"></svg>'+topics.map((t,i)=>{
      const ps=topicProblems(t.id),solved=ps.filter(isSolved).length,review=ps.filter((p)=>statusOf(p)==='review').length;
      const pending=state.data.contests.some((c)=>c.topicId===t.id&&c.import_status!=='complete');
      return `<button class="topic-node ${state.selectedTopic===t.id?'active':parents.has(t.id)?'route-parent':children.has(t.id)?'route-child':''}" data-map-topic="${escape(t.id)}" aria-pressed="${state.selectedTopic===t.id}"><span class="topic-order">${String(i+1).padStart(2,'0')}${t.interview_priority===false?' · дополнительно':''}</span><h3>${escape(t.title)}</h3><div class="topic-progress"><span><span class="solved-count">${solved}</span> / ${ps.length} задач</span>${review?`<span>↺ ${review}</span>`:''}</div><div class="topic-node-track"><span style="width:${ps.length?solved/ps.length*100:0}%"></span></div>${pending?'<span class="pending-topic">ещё есть неимпортированные домашки</span>':''}${t.prerequisites?.length?`<span class="topic-mobile-prerequisites">После: ${t.prerequisites.map((id)=>escape(topicOf(id)?.title||id)).join(', ')}</span>`:''}</button>`;
    }).join('');
    renderTopicDetail();
    if(!mapObserver){mapObserver=new ResizeObserver(scheduleMapEdges);mapObserver.observe($('topic-map'));}
    scheduleMapEdges();
  }
  function drawMapEdges(){
    const map=$('topic-map'),svg=map?.querySelector('.topic-connectors');
    if(!svg||map.clientWidth===0)return;
    const rect=map.getBoundingClientRect(),width=map.clientWidth,height=map.clientHeight;
    const rowGap=parseFloat(getComputedStyle(map).rowGap)||28,colGap=parseFloat(getComputedStyle(map).columnGap)||18;
    const boxes=new Map([...map.querySelectorAll('[data-map-topic]')].map((node)=>{const r=node.getBoundingClientRect();return[node.dataset.mapTopic,{x:r.left-rect.left,y:r.top-rect.top,w:r.width,h:r.height,cx:r.left-rect.left+r.width/2,cy:r.top-rect.top+r.height/2}];}));
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.setAttribute('width',width);svg.setAttribute('height',height);
    let paths='';let edge=0;
    for(const child of state.data.topics){
      const target=boxes.get(child.id);if(!target)continue;
      for(const parentId of child.prerequisites||[]){
        const source=boxes.get(parentId);if(!source)continue;
        const active=parentId===state.selectedTopic||child.id===state.selectedTopic;
        const sameRow=Math.abs(source.y-target.y)<5,sameColumn=Math.abs(source.x-target.x)<5;
        let points;
        if(sameRow&&Math.abs(source.cx-target.cx)<source.w+colGap+5){
          const right=target.cx>source.cx;points=[[right?source.x+source.w:source.x,source.cy],[right?target.x:target.x+target.w,target.cy]];
        }else if(sameRow){
          const lane=Math.max(0,Math.min(source.y,target.y)-rowGap/2+2);
          points=[[source.cx,source.y],[source.cx,lane],[target.cx,lane],[target.cx,target.y]];
        }else{
          const direction=target.cy>source.cy?1:-1;
          const sy=direction>0?source.y+source.h:source.y,ey=direction>0?target.y:target.y+target.h;
          if(sameColumn&&Math.abs(source.cy-target.cy)<source.h+rowGap+5)points=[[source.cx,sy],[target.cx,ey]];
          else{
            const right=target.cx>source.cx+5;
            const channel=(right?source.x+source.w+colGap/2:source.x-colGap/2)+((edge%3)-1)*2;
            const startLane=sy+direction*(rowGap/2-2),endLane=ey-direction*(rowGap/2-2);
            points=[[source.cx,sy],[source.cx,startLane],[channel,startLane],[channel,endLane],[target.cx,endLane],[target.cx,ey]];
          }
        }
        const d=points.map((point,i)=>`${i?'L':'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
        paths+=`<path class="topic-edge ${active?'selected-edge':'quiet-edge'}" data-from="${escape(parentId)}" data-to="${escape(child.id)}" d="${d}" marker-end="url(#topic-arrow-${active?'active':'quiet'})"/>`;edge++;
      }
    }
    svg.innerHTML='<defs><marker id="topic-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#b69a63"/></marker><marker id="topic-arrow-quiet" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#6a6a6a"/></marker></defs>'+paths;
  }
  function routeNavigation(topic){
    const parents=(topic.prerequisites||[]).map(topicOf).filter(Boolean);
    const children=state.data.topics.filter((t)=>(t.prerequisites||[]).includes(topic.id)).sort((a,b)=>(a.order||0)-(b.order||0));
    const group=(label,topics)=>topics.length?`<div class="route-group"><h3>${label}</h3><div class="route-chips">${topics.map((t)=>`<button class="route-chip" data-map-topic="${escape(t.id)}">${escape(t.title)}</button>`).join('')}</div>`:'';
    return parents.length||children.length?`<nav class="topic-route-navigation" aria-label="Связанные темы">${group('До этой темы',parents)}${group('Дальше',children)}</nav>`:'';
  }
  function renderTopicDetail(){
    const t=topicOf(state.selectedTopic);if(!t){$('topic-detail').innerHTML='<p class="muted">Выбери тему на карте.</p>';return;}
    const ps=topicProblems(t.id),solved=ps.filter(isSolved).length;
    $('topic-detail').innerHTML=`<h2>${escape(t.title)}</h2><p>${escape(t.summary||'')}</p>${routeNavigation(t)}<div class="theory-actions"><button class="button tiny" data-copy-prompt="${escape(t.id)}">Обсудить с GPT</button><a class="button tiny ghost" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Открыть чат ↗</a></div><div class="topic-detail-count">${solved} решено · ${ps.filter((p)=>!isSolved(p)).length} осталось в текущем каталоге</div>${ps.slice(0,12).map((p)=>`<button class="topic-problem" data-problem="${escape(p.id)}"><span class="status-icon ${statusOf(p)}">${statusSymbol(p)}</span><span>${escape(p.title)}</span><span class="difficulty ${difficulty(p).toLowerCase()}">${escape(p.difficulty==='Unknown'?'':p.difficulty||'')}</span></button>`).join('')||'<p class="muted small">Задачи появятся после импорта домашнего контеста.</p>'}<button class="button ghost map-browse" data-filter-topic="${escape(t.id)}">Все задачи темы (${ps.length})</button>`;
  }

  async function copyPrompt(topicId){const t=topicOf(topicId);const p=current();const prompt=`Я готовлюсь к стажировке и решаю алгоритмические задачи на Python.\n\nТема: ${t?.title||p?.title||'алгоритмы'}.\n${t?.summary||''}\n\nПомоги вспомнить теорию перед решением: объясни основную идею, инварианты, сложность и типичные ошибки. Дай небольшой визуальный пример или схему и задай проверочный вопрос. Не показывай готовое решение задачи и не пиши код, пока я сам не попрошу.${p&&topicIds(p).includes(topicId)?'\n\nМоя задача: '+p.title+'\n'+(p.url||''):''}`;await copyText(prompt);toast('Запрос скопирован. Вставь его в свой чат GPT.');}
  async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();document.execCommand('copy');input.remove();}}
  function epoch(value){if(typeof value==='number')return value<1e12?value*1000:value;return Date.parse(value)||0;}
  function remainingSeconds(){const interview=state.interview;if(!interview)return 3600;if(interview.status==='running'&&interview.expires_at)return Math.max(0,Math.ceil((epoch(interview.expires_at)-Date.now())/1000));return Math.max(0,Math.round(interview.remaining_seconds??3600));}
  function formatTime(seconds){return`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
  async function getPair(){try{const result=await api('pair');state.pair=result.problem_ids||[];renderInterview();}catch(error){toast(error.message,true);}}
  function renderInterview(){if(!state.data)return;const interview=state.interview||{status:'idle'};const active=['running','paused'].includes(interview.status);const ids=active?interview.problem_ids:state.pair;const ps=ids.map((id)=>state.data.problems.find((p)=>p.id===id)).filter(Boolean);$('interview-pair').innerHTML=ps.length?ps.map((p,i)=>`<article class="pair-card"><div class="pair-number">ЗАДАЧА ${i+1} ИЗ 2 ${interview.results?.find((r)=>r.problem_id===p.id)?.solved?' · ✓ В ЭТОМ ЧАСЕ':isSolved(p)?' · РЕШЕНА РАНЬШЕ':''}</div><h3><button class="pair-title-button" data-problem="${escape(p.id)}">${escape(p.title)}</button></h3><div class="pair-meta"><span class="difficulty ${difficulty(p).toLowerCase()}">${escape(difficulty(p))}</span><span class="muted">${escape(topicIds(p).map((id)=>topicOf(id)?.title||id).slice(0,1).join(''))}</span></div><button class="button" data-problem="${escape(p.id)}">Открыть задачу</button>${!active?`<select data-pair-index="${i}" aria-label="Выбрать задачу ${i+1}">${state.data.problems.map((item)=>`<option value="${escape(item.id)}" ${item.id===p.id?'selected':''}>${escape(item.title)} · ${escape(difficulty(item))}</option>`).join('')}</select>`:''}</article>`).join(''):'<div class="empty-state">После импорта задач здесь появится пара для тренировки.</div>';$('start-interview').hidden=active;$('start-interview').disabled=ps.length!==2;$('pause-interview').hidden=!active;$('pause-interview').textContent=interview.status==='paused'?'▷ Продолжить':'Пауза';$('finish-interview').hidden=!active;$('new-pair').hidden=active;$('interview-state-label').textContent=({idle:'Готов к следующей тренировке',running:'Час идёт. Обдумывание входит в тренировку.',paused:'Таймер на паузе',finished:'Тренировка завершена. Можно разобрать решения.'})[interview.status]||'Готов к тренировке';const timedCount=(interview.results||[]).filter((r)=>r.solved).length;if(interview.status==='finished')$('interview-state-label').textContent=`Тренировка завершена · ${timedCount} из 2 задач принято за час.`;$('strip-pair-label').textContent=`${timedCount} / 2 принято`;$('interview-strip').hidden=!active;$('strip-problems').innerHTML=ps.map((p,i)=>`<button class="strip-problem" data-problem="${escape(p.id)}">${i+1}. ${escape(p.title)}</button>`).join('');tickInterview();renderProgress();}
  function tickInterview(){const seconds=remainingSeconds();const text=formatTime(seconds);$('interview-clock').innerHTML=text.replace(':','<span>:</span>');$('interview-clock').classList.toggle('finished',seconds===0);$('strip-time').textContent=text;$('nav-timer').textContent=text;$('nav-timer').hidden=!['running','paused'].includes(state.interview?.status);if(seconds===0&&state.interview?.status==='running'&&!state.finishingInterview){state.finishingInterview=true;interviewAction('finish').finally(()=>state.finishingInterview=false);}}
  async function interviewAction(action){try{await flushDraft();const body={action};if(action==='start')body.problem_ids=state.pair;state.interview=await api('interview',body);renderInterview();if(action==='start'&&state.interview.problem_ids?.[0])await selectProblem(state.interview.problem_ids[0]);}catch(error){toast(error.message,true);}}
  function openConnection(){$('connection-dialog').showModal();renderBridge();}
  function renderBridge(){
    const bridge=state.bridge||{},paused=!!bridge.paused,connected=!!bridge.connected&&!paused;
    $('connection-dot').classList.toggle('connected',connected);$('dialog-connection-dot').classList.toggle('connected',connected);
    const label=paused?'Dia на паузе':connected?'Dia подключена':'Dia';
    $('connection-label').textContent=label;$('bridge-button').title=label;$('bridge-button').setAttribute('aria-label',label);
    $('dialog-connection-label').textContent=paused?'Dia на паузе':connected?'Расширение подключено':'Ожидаем расширение…';
    $('bridge-description').textContent=paused?'Интеграция с Dia на паузе. Локальные Run и Debug доступны.':connected?'Dia подключена. Официальная проверка выполняется в источнике задачи.':'Расширение переносит условия и отправляет код через твой открытый аккаунт.';
    $('bridge-setup-steps').hidden=paused||connected;$('copy-extension-url').disabled=paused;
    $('import-courses').disabled=paused||!connected;$('import-leetcode').disabled=paused||!connected;
    const jobs=Array.isArray(bridge.jobs)?bridge.jobs:Object.values(bridge.jobs||{});
    $('bridge-jobs').innerHTML=jobs.slice(-8).reverse().map((j)=>`<div class="bridge-job"><span>${escape(j.dry_run?'Проверка интеграции · без отправки':({import_contests:'Импорт курсов',import_leetcode:'Импорт LeetCode',submit:'Отправка решения'})[j.action]||j.action||'Задание')}</span> · <span class="${j.status==='error'?'error':''}">${escape(briefBridgeMessage(j.message||j.verdict||({queued:'В очереди',running:'Выполняется',complete:'Готово',error:'Ошибка',progress:'Выполняется'})[j.status]||j.status||''))}</span></div>`).join('');
    if(current()&&state.description==='submissions')renderSubmissions();renderSubmitMode();
  }

  function terminalJobsStamp(bridge){
    const jobs=Array.isArray(bridge?.jobs)?bridge.jobs:Object.values(bridge?.jobs||{});
    return JSON.stringify(jobs.filter((job)=>['complete','error'].includes(job.status))
      .map((job)=>[job.job_id,job.status,job.verdict||'',String(job.run_id||''),job.updated_at||job.created_at||0,!!job.dry_run])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
  }
  async function refreshBridge(){
    if(state.bridgeRefreshPromise)return state.bridgeRefreshPromise;
    state.bridgeRefreshPromise=(async()=>{
      try{
        const bridge=await api('bridge/status');state.bridge=bridge;renderBridge();await retryDirtyDrafts();
        const jobs=Array.isArray(bridge.jobs)?bridge.jobs:Object.values(bridge.jobs||{});
        for(const job of jobs){
          const old=state.knownJobs.get(job.job_id);
          if(['complete','error'].includes(job.status)&&old&&old!==job.status)
            toast(job.message||job.verdict||(job.status==='complete'?'Готово':'Не удалось выполнить задание'),officialVerdictTone(job)==='failed');
          state.knownJobs.set(job.job_id,job.status);
        }
        const changed=terminalJobsStamp(bridge)!==state.appliedBridgeStamp;
        const importing=jobs.some((job)=>['running','progress'].includes(job.status))&&Date.now()-(state.lastImportRefresh||0)>7000;
        if(changed||importing){await loadData(false);state.lastImportRefresh=Date.now();}
      }catch{
        // Keep the last applied stamp so a temporary bootstrap failure retries.
      }finally{state.bridgeRefreshPromise=null;}
    })();
    return state.bridgeRefreshPromise;
  }
  async function queueImport(action){if(state.bridge?.paused){toast('Dia на паузе. Импорт отключён.');return;}try{const body={action};if(action==='import_leetcode')body.urls=state.data.problems.filter((p)=>p.source==='leetcode'&&p.url).map((p)=>p.url);const result=await api('bridge/queue',body);state.knownJobs.set(result.job_id,'queued');toast('Импорт передан в Dia. Можно продолжать работать.');await refreshBridge();}catch(error){toast(error.message,true);}}
  async function loadData(initial=true){
    const retainedBefore=initial?new Set():new Set([...state.dirty,...state.draftWrites.keys()]);
    if(!initial&&current())retainedBefore.add(state.currentId);
    const data=await api('bootstrap');
    data.problems=data.problems||[];data.topics=data.topics||[];data.contests=data.contests||[];data.drafts=data.drafts||{};
    if(!initial&&state.data){
      const retained=new Set([...retainedBefore,...state.dirty,...state.draftWrites.keys()]);if(current())retained.add(state.currentId);
      for(const id of retained){const old=state.data.drafts[id];if(old)data.drafts[id]={...(data.drafts[id]||{}),code:old.code,notes:old.notes};}
    }
    state.data=data;state.interview=data.interview||state.interview;
    if(initial&&!state.pair.length&&state.interview?.problem_ids?.length)state.pair=[...state.interview.problem_ids];
    state.bridge=data.bridge||state.bridge;
    const selectedFilter=$('topic-filter').value;
    $('topic-filter').innerHTML='<option value="">Все темы</option>'+data.topics.map((topic)=>`<option value="${escape(topic.id)}">${escape(topic.title)}</option>`).join('');
    $('topic-filter').value=selectedFilter;
    renderProgress();renderCatalog();renderMap();renderBridge();renderInterview();
    if(initial){
      let remembered;try{remembered=localStorage.getItem('algo-current-problem');}catch{}
      const first=data.problems.find((p)=>p.id===remembered)||data.problems.find((p)=>p.imported&&!isSolved(p))||data.problems.find((p)=>p.imported)||data.problems[0];
      if(first)await selectProblem(first.id,false);else renderProblem();
      const hash=location.hash.slice(1);switchView(['workspace','catalog','map','interview'].includes(hash)?hash:'workspace');
      if(!state.pair.length&&!['running','paused'].includes(state.interview?.status))await getPair();
    }else{
      renderProblem();
      if(current()){$('problem-status').value=statusOf(current());$('assisted-checkbox').checked=!!draftOf(current()).assisted;}
      if(state.view==='catalog')renderCatalog();if(state.view==='map')renderMap();
    }
    state.appliedBridgeStamp=terminalJobsStamp(data.bridge||state.bridge);
  }
  function initSplitters(){const vertical=$('vertical-split'),horizontal=$('horizontal-split');function drag(element,apply){element.addEventListener('pointerdown',(event)=>{if(event.button!==0)return;event.preventDefault();element.setPointerCapture(event.pointerId);const move=(e)=>apply(e);const stop=()=>{element.removeEventListener('pointermove',move);element.removeEventListener('pointerup',stop);state.editor?.layout();};element.addEventListener('pointermove',move);element.addEventListener('pointerup',stop);});}drag(vertical,(e)=>{const rect=$('workbench').getBoundingClientRect();const ratio=Math.max(26,Math.min(65,(e.clientX-rect.left)/rect.width*100));$('workbench').style.setProperty('--left',`${ratio}%`);state.editor?.layout();});drag(horizontal,(e)=>{const rect=$('coding-column').getBoundingClientRect();const ratio=Math.max(22,Math.min(65,(rect.bottom-e.clientY)/rect.height*100));state.consoleCollapsed=false;$('coding-column').style.setProperty('--console',`${ratio}%`);$('toggle-console').innerHTML=icon('down');state.editor?.layout();});vertical.addEventListener('keydown',(e)=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const currentRatio=parseFloat(getComputedStyle($('workbench')).getPropertyValue('--left'))||43;$('workbench').style.setProperty('--left',`${Math.min(65,Math.max(26,currentRatio+(e.key==='ArrowRight'?2:-2)))}%`);state.editor?.layout();});horizontal.addEventListener('keydown',(e)=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const ratio=parseFloat(getComputedStyle($('coding-column')).getPropertyValue('--console'))||34;$('coding-column').style.setProperty('--console',`${Math.min(65,Math.max(22,ratio+(e.key==='ArrowUp'?3:-3)))}%`);state.editor?.layout();});}
  function setupEvents(){document.addEventListener('click',async(event)=>{const b=event.target.closest('button,a');if(!b)return;const data=b.dataset;if(data.loadJudgeFailure){await loadJudgeFailure(data.loadJudgeFailure);return;}if(data.submitMode){setSubmitMode(data.submitMode);return;}if(data.view){event.preventDefault();switchView(data.view);}if(data.problem)await selectProblem(data.problem);if(data.description)setDescriptionTab(data.description);if(data.console)setConsoleTab(data.console);if(data.example!==undefined)selectExample(data.example);if(data.addTest!==undefined)addTestCase();if(data.resultCase!==undefined)selectResultCase(Number(data.resultCase));if(data.resultDiff!==undefined)toggleResultDiff();if(data.debug)await debugCommand(data.debug);if(data.showTopics!==undefined){const list=$('problem-topic-list');if(list)list.hidden=!list.hidden;}if(data.topic){state.selectedTopic=data.topic;switchView('map');}if(data.mapTopic){state.selectedTopic=data.mapTopic;renderMap();if(innerWidth<=850)requestAnimationFrame(()=>$('topic-detail').scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));}if(data.filterTopic){$('topic-filter').value=data.filterTopic;switchView('catalog');}if(data.copyPrompt!==undefined)await copyPrompt(data.copyPrompt);if(data.connect!==undefined)openConnection();});$('open-catalog').onclick=()=>switchView('catalog');$('random-problem').onclick=()=>{const pool=state.data.problems.filter((p)=>!isSolved(p)&&!p.premium&&statementReady(p)&&priorityOf(p));if(pool.length)selectProblem(pool[Math.floor(Math.random()*pool.length)].id);};$('bookmark-problem').onclick=()=>setProgress($('problem-status').value==='review'?(current().solved?'solved':'todo'):'review');$('maximize-editor').onclick=()=>{document.body.classList.toggle('editor-maximized');requestAnimationFrame(()=>state.editor?.layout());};$('toggle-console').onclick=()=>expandConsole(state.consoleCollapsed);$('goal-button').onclick=()=>switchView('interview');$('bridge-button').onclick=openConnection;$('import-button').onclick=openConnection;$('close-connection').onclick=()=>$('connection-dialog').close();$('connection-dialog').addEventListener('click',(e)=>{if(e.target===$('connection-dialog'))$('connection-dialog').close();});$('copy-extension-url').onclick=async()=>{await copyText('chrome://extensions/');toast('Адрес скопирован. Вставь его в адресную строку Dia.');};$('import-courses').onclick=()=>queueImport('import_contests');$('import-leetcode').onclick=()=>queueImport('import_leetcode');$('run-button').onclick=runCode;$('debug-button').onclick=startDebug;$('submit-button').onclick=submitCode;$('submit-mode-button').onclick=()=>setSubmitMenu($('submit-mode-menu').hidden);document.addEventListener('click',(event)=>{if(!event.target.closest('#submit-control'))setSubmitMenu(false);});$('submit-mode-menu').addEventListener('keydown',handleSubmitMenuKey);$('problem-status').onchange=()=>setProgress($('problem-status').value);$('assisted-checkbox').onchange=()=>setProgress($('problem-status').value);$('problem-notes').addEventListener('input',saveSoon);$('fallback-editor').addEventListener('input',saveSoon);$('argument-fields').addEventListener('input',syncArgumentFields);$('stdin-input').addEventListener('input',captureSelectedTest);$('expected-output').addEventListener('input',captureSelectedTest);$('test-cases').addEventListener('keydown',caseTabsKey);$('result-body').addEventListener('keydown',caseTabsKey);$('fallback-editor').addEventListener('keydown',(e)=>{if(e.key==='Tab'){e.preventDefault();const el=e.target;el.setRangeText('    ',el.selectionStart,el.selectionEnd,'end');saveSoon();}});$('reset-code').onclick=()=>{if(!current())return;if(!confirm('Вернуть начальный код этой задачи? Текущий код будет заменён.'))return;if(state.editor)state.editor.setValue(defaultCode(current()));else{$('fallback-editor').value=defaultCode(current());saveSoon();}};$('editor-settings').onclick=()=>{state.fontSize=state.fontSize===18?12:state.fontSize+1;state.editor?.updateOptions({fontSize:state.fontSize});$('fallback-editor').style.fontSize=`${state.fontSize}px`;};for(const id of ['search-input','source-filter','topic-filter','difficulty-filter','status-filter'])$(id).addEventListener(id==='search-input'?'input':'change',renderCatalog);$('previous-problem').onclick=()=>navigateProblem(-1);$('next-problem').onclick=()=>navigateProblem(1);$('start-interview').onclick=()=>interviewAction('start');$('pause-interview').onclick=()=>interviewAction(state.interview?.status==='paused'?'resume':'pause');$('finish-interview').onclick=()=>interviewAction('finish');$('new-pair').onclick=async()=>{state.interview={status:'idle',remaining_seconds:3600};await getPair();};$('interview-pair').addEventListener('change',(e)=>{if(e.target.dataset.pairIndex===undefined)return;state.pair[Number(e.target.dataset.pairIndex)]=e.target.value;if(state.pair[0]===state.pair[1]){toast('Для тренировки нужны две разные задачи.');$('start-interview').disabled=true;}else $('start-interview').disabled=false;});document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!$('submit-mode-menu').hidden){e.preventDefault();setSubmitMenu(false);$('submit-mode-button').focus();return;}if((e.metaKey||e.ctrlKey)&&e.key==='Enter'&&!e.target.closest('.monaco-editor')){e.preventDefault();runCode();}if(state.debug?.status==='paused'&&e.key==='F10'){e.preventDefault();debugCommand('next');}if(state.debug?.status==='paused'&&e.key==='F11'){e.preventDefault();debugCommand('step');}});window.addEventListener('pagehide',()=>{const p=current();if(p&&state.dirty.has(p.id))fetch('/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({problem_id:p.id,code:codeValue(),notes:$('problem-notes').value}),keepalive:true}).catch(()=>{});});initSplitters();}
  function navigateProblem(direction){if(!state.data?.problems.length)return;const index=state.data.problems.findIndex((p)=>p.id===state.currentId);const next=(index+direction+state.data.problems.length)%state.data.problems.length;selectProblem(state.data.problems[next].id);}
  async function boot(){setupEvents();updateRunButtons();try{await loadData();initEditor();}catch(error){$('description-content').innerHTML=`<div class="empty-state"><h2>Не удалось подключиться</h2><p>${escape(error.message)}</p><button class="button" id="retry-connection">Повторить</button></div>`;$('retry-connection').onclick=()=>location.reload();}setInterval(tickInterview,1000);setInterval(()=>{if(!document.hidden)refreshBridge();},4000);}
  $('result-body').addEventListener('click',async(event)=>{
    const button=event.target.closest('[data-complete-local]');if(!button)return;
    const id=button.dataset.completeLocal,result=state.judgeResults.get(id);
    if(!result||result.verdict!=='LOCAL_OK'||result.passed_count!==result.total)return;
    button.disabled=true;
    try{if(state.currentId!==id)await selectProblem(id);await setProgress('solved');renderJudgeResult(result,current());}
    catch(error){button.disabled=false;toast(error.message,true);}
  });
  boot();
})();
