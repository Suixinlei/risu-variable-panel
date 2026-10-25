//@name variable_panel
//@display-name 变量面板
//@api 3.0
//@version 1.0.0

// 变量面板 — 酒馆助手风格的聊天变量编辑器
//
// 聊天变量: 直接读写当前聊天的 scriptstate,与 {{getvar}} / {{setvar}} /
//   Lua chatvar / /setvar 命令完全同源,按聊天隔离。
// 全局变量: 插件沙箱无法读写数据库级全局变量,此处管理的是本聊天对
//   全局变量的覆盖层(GLGlobalVariables),{{getglobalvar}} 优先读取它,
//   删除覆盖后回落到全局值。

(async () => {
    const S = {
        built: false,
        loading: false,
        tab: 'chat',
        charName: '',
        chatName: '',
        loadedChaId: null,
        loadedChatPage: null,
        rows: [], // 聊天变量行 {origKey, key, rawValue, value, isNew, badJSON}
        globalRows: [], // 全局覆盖行 {origKey(=key), key, rawValue, value, isNew, badJSON}
        defaults: [], // 未落地的默认变量 {key, effective}
        snapshot: { vars: {}, gl: {} },
        filter: '',
        refs: {},
    };

    const ref = (id) => S.refs[id];

    // ---------- 值处理 ----------
    const isJSONish = (t) =>
        (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));

    function pretty(v) {
        const s = String(v ?? '');
        const t = s.trim();
        if (isJSONish(t)) {
            try {
                return JSON.stringify(JSON.parse(t), null, 2);
            } catch (e) {}
        }
        return s;
    }

    // 保存时使用的最终字符串:未编辑保持原样;编辑过的 JSON 压缩回单行
    function finalValue(row) {
        const cur = row.value ?? '';
        if (cur === pretty(row.rawValue)) return row.rawValue ?? '';
        const t = cur.trim();
        if (isJSONish(t)) {
            try {
                return JSON.stringify(JSON.parse(t));
            } catch (e) {
                return cur;
            }
        }
        return cur;
    }

    function checkJSON(row) {
        const t = (row.value ?? '').trim();
        row.badJSON = isJSONish(t) && !safeParse(t);
        row.isJSON = !row.badJSON && isJSONish(t) && !!safeParse(t);
    }

    function safeParse(t) {
        try {
            return JSON.parse(t) || true;
        } catch (e) {
            return null;
        }
    }

    // 行在 scriptstate 里的真实键名
    function storeKey(row) {
        const k = (row.key ?? '').trim();
        if (row.origKey && !row.origKey.startsWith('$')) return row.origKey; // 保留非标准键
        return '$' + k;
    }

    // 复刻 util.parseKeyValue(仅用于枚举默认变量键名)
    function parseDefaults(t) {
        if (!t) return [];
        const out = [];
        for (const line of String(t).split('\n')) {
            const i = line.indexOf('=');
            if (i > 0) {
                const k = line.slice(0, i).trim();
                const v = line.slice(i + 1);
                if (k && v) out.push([k, v]);
            }
        }
        return out;
    }

    function currentMaps() {
        const vars = {};
        const gl = {};
        for (const r of S.rows) {
            if (!(r.key ?? '').trim()) continue;
            vars[storeKey(r)] = finalValue(r);
        }
        for (const r of S.globalRows) {
            if (!(r.key ?? '').trim()) continue;
            gl[r.key.trim()] = finalValue(r);
        }
        return { vars, gl };
    }

    function diffCount() {
        const cur = currentMaps();
        let n = 0;
        for (const k of new Set([...Object.keys(S.snapshot.vars), ...Object.keys(cur.vars)])) {
            if (S.snapshot.vars[k] !== cur.vars[k]) n++;
        }
        for (const k of new Set([...Object.keys(S.snapshot.gl), ...Object.keys(cur.gl)])) {
            if (S.snapshot.gl[k] !== cur.gl[k]) n++;
        }
        return n;
    }

    // ---------- 数据 ----------
    async function loadChar() {
        const char = await risuai.getCharacter();
        if (!char || !Array.isArray(char.chats) || typeof char.chatPage !== 'number' || !char.chats[char.chatPage]) {
            return null;
        }
        return char;
    }

    async function reload() {
        if (S.loading) return;
        S.loading = true;
        setStatus('加载中…');
        try {
            const char = await loadChar();
            if (!char) {
                S.rows = [];
                S.globalRows = [];
                S.defaults = [];
                S.snapshot = { vars: {}, gl: {} };
                S.charName = '';
                S.chatName = '';
                S.loadedChaId = null;
                S.loadedChatPage = null;
                renderAll();
                setStatus('未打开任何聊天 — 请先进入一个角色的对话');
                return;
            }
            const chat = char.chats[char.chatPage];
            S.charName = char.name ?? '';
            S.chatName = chat.name || '聊天 ' + (char.chatPage + 1);
            S.loadedChaId = char.chaId;
            S.loadedChatPage = char.chatPage;

            const ss = chat.scriptstate ?? {};
            const gl = chat.GLGlobalVariables ?? {};
            S.rows = Object.entries(ss).map(([k, v]) => ({
                origKey: k,
                key: k.startsWith('$') ? k.slice(1) : k,
                rawValue: String(v ?? ''),
                value: '',
                isNew: false,
            }));
            S.rows.forEach((r) => {
                r.value = pretty(r.rawValue);
                checkJSON(r);
            });
            S.globalRows = Object.entries(gl).map(([k, v]) => ({
                origKey: k,
                key: k,
                rawValue: String(v ?? ''),
                value: '',
                isNew: false,
            }));
            S.globalRows.forEach((r) => {
                r.value = pretty(r.rawValue);
                checkJSON(r);
            });
            S.snapshot = {
                vars: Object.fromEntries(Object.entries(ss).map(([k, v]) => [k, String(v ?? '')])),
                gl: Object.fromEntries(Object.entries(gl).map(([k, v]) => [k, String(v ?? '')])),
            };

            // 默认变量(角色/预设里定义、本聊天尚未写入的)
            S.defaults = [];
            const dv = parseDefaults(char.defaultVariables);
            for (const [k] of dv) {
                if (ss['$' + k] !== undefined || ss[k] !== undefined) continue;
                let eff = '(无法预读)';
                if (!/[:}\s]/.test(k)) {
                    try {
                        const r = await risuai.parseRisuChat('{{getvar::' + k + '}}');
                        if (typeof r === 'string' && !r.includes('{{')) eff = r;
                    } catch (e) {}
                }
                S.defaults.push({ key: k, effective: eff });
            }
            renderAll();
            setStatus('');
        } catch (e) {
            setStatus('加载失败: ' + ((e && e.message) || String(e)));
        } finally {
            S.loading = false;
        }
    }

    async function save() {
        if (S.loading) return;
        const rows = S.tab === 'chat' ? S.rows : S.globalRows;
        if (rows.some((r) => !(r.key ?? '').trim())) {
            toast('有变量名为空的行,保存时会被跳过');
        }
        const keys = rows.filter((r) => (r.key ?? '').trim()).map((r) => (S.tab === 'chat' ? storeKey(r) : r.key.trim()));
        if (new Set(keys).size !== keys.length) {
            toast('存在重复的变量名,请先修正');
            return;
        }
        if ([...S.rows, ...S.globalRows].some((r) => r.badJSON)) {
            toast('存在无效 JSON,将按原样保存为字符串(红色标记的行)');
        }

        S.loading = true;
        setStatus('保存中…');
        try {
            const fresh = await loadChar();
            if (!fresh) {
                setStatus('当前没有打开的聊天');
                return;
            }
            if (
                S.loadedChaId != null &&
                (fresh.chaId !== S.loadedChaId || fresh.chatPage !== S.loadedChatPage)
            ) {
                toast('打开的聊天已切换,为避免写错位置已取消保存。请点「刷新」后重试。');
                setStatus('');
                return;
            }
            const chat = fresh.chats[fresh.chatPage];
            const cur = currentMaps();
            chat.scriptstate = cur.vars;
            chat.GLGlobalVariables = cur.gl;
            await risuai.setCharacter(fresh);
            await reload();
            toast('已保存 ✓');
        } catch (e) {
            setStatus('保存失败: ' + ((e && e.message) || String(e)));
        } finally {
            S.loading = false;
        }
    }

    // ---------- UI ----------
    const CSS = `
        * { box-sizing: border-box; }
        html, body { margin: 0; height: 100%; }
        body {
            background: rgba(0,0,0,.55);
            font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
            font-size: 14px;
            display: flex; align-items: center; justify-content: center;
            color: #e5e5e5;
        }
        #card {
            width: min(880px, 94vw); max-height: 88vh;
            background: #1e1e1e; border: 1px solid #333; border-radius: 12px;
            box-shadow: 0 12px 48px rgba(0,0,0,.6);
            display: flex; flex-direction: column; overflow: hidden;
        }
        #header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #2c2c2c; }
        #title { font-size: 16px; font-weight: 700; }
        #sub { color: #9a9a9a; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #close { margin-left: auto; background: none; border: none; color: #9a9a9a; font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
        #close:hover { background: #2c2c2c; color: #fff; }
        #toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; flex-wrap: wrap; }
        .tab { background: #262626; color: #bbb; border: 1px solid #333; border-radius: 999px; padding: 5px 14px; cursor: pointer; font-size: 13px; }
        .tab.active { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
        #search { background: #141414; border: 1px solid #333; border-radius: 8px; color: #e5e5e5; padding: 6px 10px; width: 150px; font-size: 13px; outline: none; }
        #search:focus { border-color: #3b82f6; }
        .btn { border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; border: 1px solid #333; background: #262626; color: #e5e5e5; }
        .btn:hover { background: #303030; }
        .btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
        .btn.primary:disabled { background: #262626; border-color: #333; color: #666; cursor: default; }
        .btn.primary:hover:not(:disabled) { background: #2563eb; }
        #body { flex: 1; overflow-y: auto; padding: 4px 16px 12px; }
        .thead, .row { display: grid; grid-template-columns: 200px 1fr 56px; gap: 10px; align-items: start; padding: 8px 0; }
        .thead { color: #888; font-size: 12px; border-bottom: 1px solid #2c2c2c; position: sticky; top: 0; background: #1e1e1e; z-index: 1; padding-top: 10px; }
        .row { border-bottom: 1px solid #242424; }
        .row.new .key { border-color: #3b82f6; }
        .key {
            background: #141414; border: 1px solid #333; border-radius: 8px; color: #e5e5e5;
            padding: 7px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-weight: 600; font-size: 13px; width: 100%; outline: none; margin-top: 2px;
        }
        .key:focus { border-color: #3b82f6; }
        .key[readonly] { color: #d4a017; border-style: dashed; }
        .valwrap { position: relative; min-width: 0; }
        textarea.val {
            background: #141414; border: 1px solid #333; border-radius: 8px; color: #e5e5e5;
            padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 12.5px; line-height: 1.5; width: 100%; min-height: 34px;
            resize: none; overflow: hidden; outline: none; white-space: pre-wrap; word-break: break-all;
        }
        textarea.val:focus { border-color: #3b82f6; }
        textarea.val.badjson { border-color: #dc2626; }
        .badge {
            position: absolute; top: -7px; right: 8px; font-size: 10px; padding: 1px 6px;
            border-radius: 999px; background: #1e3a8a; color: #93c5fd; border: 1px solid #1e40af;
            display: none; pointer-events: none;
        }
        .badge.on { display: inline-block; }
        .del { background: none; border: none; color: #777; font-size: 15px; cursor: pointer; padding: 6px 4px; border-radius: 6px; margin-top: 4px; }
        .del:hover { color: #ef4444; background: #2c2c2c; }
        .empty { color: #777; text-align: center; padding: 28px 0; font-size: 13px; }
        details#defaults { margin-top: 10px; border: 1px dashed #333; border-radius: 8px; padding: 6px 12px; }
        details#defaults summary { color: #9a9a9a; font-size: 12.5px; cursor: pointer; padding: 4px 0; user-select: none; }
        .drow { display: grid; grid-template-columns: 200px 1fr 64px; gap: 10px; align-items: center; padding: 5px 0; border-top: 1px solid #242424; }
        .dkey { font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 600; color: #d4a017; overflow: hidden; text-overflow: ellipsis; }
        .dval { color: #8a8a8a; font-size: 12px; font-family: ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dadd { background: #262626; color: #93c5fd; border: 1px solid #333; border-radius: 6px; cursor: pointer; font-size: 12px; padding: 3px 10px; }
        .dadd:hover { border-color: #3b82f6; }
        .hint { color: #8a8a8a; font-size: 12px; line-height: 1.6; padding: 8px 2px; }
        .gladd { display: flex; gap: 8px; padding: 6px 0 10px; }
        .gladd .key { width: 220px; flex: none; }
        #footer { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid #2c2c2c; }
        #status { color: #9a9a9a; font-size: 12.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #status.err { color: #ef4444; }
        #toast {
            position: fixed; bottom: 26px; left: 50%; transform: translateX(-50%);
            background: #111; border: 1px solid #444; color: #e5e5e5; border-radius: 10px;
            padding: 9px 18px; font-size: 13px; opacity: 0; transition: opacity .25s; pointer-events: none;
            box-shadow: 0 6px 24px rgba(0,0,0,.5); max-width: 80vw;
        }
        #toast.show { opacity: 1; }
    `;

    function buildUI() {
        if (S.built) return;
        S.built = true;

        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        document.body.innerHTML = `
            <div id="card">
                <div id="header">
                    <span id="title">变量面板</span>
                    <span id="sub"></span>
                    <button id="close" title="关闭 (Esc)">✕</button>
                </div>
                <div id="toolbar">
                    <button class="tab active" id="tab-chat">聊天变量</button>
                    <button class="tab" id="tab-gl">全局变量·覆盖</button>
                    <input id="search" placeholder="搜索变量名…">
                    <button class="btn" id="add">＋ 新增</button>
                    <button class="btn primary" id="save" disabled>保存</button>
                    <button class="btn" id="refresh">刷新</button>
                </div>
                <div id="body">
                    <div id="pane-chat">
                        <div class="thead"><span>变量名</span><span>值</span><span></span></div>
                        <div id="table"></div>
                        <details id="defaults" style="display:none">
                            <summary></summary>
                            <div id="dlist"></div>
                        </details>
                    </div>
                    <div id="pane-gl" style="display:none">
                        <div class="hint">
                            全局变量跨聊天共享。此处是<b>本聊天的覆盖值</b> —— {{getglobalvar}} 优先读取它,
                            删除覆盖后回落到真正的全局值。新增时可以先按名字查询当前生效值。
                        </div>
                        <div class="gladd">
                            <input class="key" id="glname" placeholder="全局变量名,如 reputation" spellcheck="false">
                            <button class="btn" id="gladd">查询并添加</button>
                        </div>
                        <div class="thead"><span>变量名</span><span>覆盖值</span><span></span></div>
                        <div id="gltable"></div>
                    </div>
                </div>
                <div id="footer">
                    <span id="status"></span>
                    <button class="btn" id="discard">放弃更改</button>
                </div>
            </div>
            <div id="toast"></div>
        `;

        for (const id of ['title', 'sub', 'close', 'tab-chat', 'tab-gl', 'search', 'add', 'save', 'refresh', 'table', 'defaults', 'dlist', 'gltable', 'glname', 'gladd', 'status', 'discard', 'toast', 'pane-chat', 'pane-gl']) {
            S.refs[id] = document.getElementById(id);
        }

        ref('close').addEventListener('click', () => risuai.hideContainer());
        ref('tab-chat').addEventListener('click', () => switchTab('chat'));
        ref('tab-gl').addEventListener('click', () => switchTab('gl'));
        ref('add').addEventListener('click', onAdd);
        ref('save').addEventListener('click', save);
        ref('refresh').addEventListener('click', reload);
        ref('discard').addEventListener('click', reload);
        ref('search').addEventListener('input', () => {
            S.filter = ref('search').value.trim().toLowerCase();
            renderTable();
        });
        ref('gladd').addEventListener('click', onAddGlobal);
        ref('glname').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onAddGlobal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') risuai.hideContainer();
        });
    }

    function switchTab(tab) {
        S.tab = tab;
        ref('tab-chat').classList.toggle('active', tab === 'chat');
        ref('tab-gl').classList.toggle('active', tab === 'gl');
        ref('pane-chat').style.display = tab === 'chat' ? '' : 'none';
        ref('pane-gl').style.display = tab === 'gl' ? '' : 'none';
        renderTable();
    }

    function onAdd() {
        const row = { origKey: null, key: '', rawValue: '', value: '', isNew: true };
        (S.tab === 'chat' ? S.rows : S.globalRows).push(row);
        renderTable();
        const inputs = ref(S.tab === 'chat' ? 'table' : 'gltable').querySelectorAll('.key');
        const last = inputs[inputs.length - 1];
        if (last) last.focus();
    }

    async function onAddGlobal() {
        const name = ref('glname').value.trim();
        if (!name) return;
        if (/[:}\s]/.test(name)) {
            toast('变量名不能包含空格、冒号或右花括号');
            return;
        }
        if (S.globalRows.some((r) => r.key === name)) {
            toast('该覆盖已存在: ' + name);
            return;
        }
        let eff = '';
        try {
            const r = await risuai.parseRisuChat('{{getglobalvar::' + name + '}}');
            if (typeof r === 'string' && !r.includes('{{') && r !== 'null') eff = r;
        } catch (e) {}
        S.globalRows.push({ origKey: name, key: name, rawValue: '', value: pretty(eff), isNew: true });
        ref('glname').value = '';
        renderTable();
        if (eff) toast('当前全局值: ' + (eff.length > 60 ? eff.slice(0, 60) + '…' : eff));
    }

    function fitArea(ta) {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 2 + 'px';
    }

    function renderAll() {
        ref('sub').textContent = S.charName ? S.charName + ' · ' + S.chatName : '';
        ref('tab-chat').textContent = '聊天变量' + (S.snapshot.vars ? ' (' + Object.keys(S.snapshot.vars).length + ')' : '');
        ref('tab-gl').textContent = '全局变量·覆盖 (' + Object.keys(S.snapshot.gl).length + ')';
        renderTable();
        renderDefaults();
        updateDirty();
    }

    function renderTable() {
        const container = ref(S.tab === 'chat' ? 'table' : 'gltable');
        container.textContent = '';
        const rows = S.tab === 'chat' ? S.rows : S.globalRows;
        const list = rows.filter((r) => !S.filter || r.key.toLowerCase().includes(S.filter));
        if (list.length === 0) {
            const e = document.createElement('div');
            e.className = 'empty';
            e.textContent = rows.length === 0 ? '暂无变量 — 点「＋ 新增」,或在聊天框用 /setvar 添加' : '没有匹配的变量';
            container.appendChild(e);
            return;
        }
        for (const row of list) {
            container.appendChild(buildRow(row));
        }
    }

    function buildRow(row) {
        const div = document.createElement('div');
        div.className = 'row' + (row.isNew ? ' new' : '');

        const key = document.createElement('input');
        key.className = 'key';
        key.value = row.key;
        key.spellcheck = false;
        // 非标准键(不带 $ 前缀的旧数据)不改名,避免破坏原有存储
        if (row.origKey && !row.origKey.startsWith('$') && !row.gl) {
            key.readOnly = true;
            key.title = '非标准键(无 $ 前缀),不支持改名';
        }
        key.addEventListener('input', () => {
            row.key = key.value;
            updateDirty();
        });

        const wrap = document.createElement('div');
        wrap.className = 'valwrap';
        const badge = document.createElement('span');
        badge.className = 'badge' + (row.isJSON ? ' on' : '');
        badge.textContent = 'JSON';
        const ta = document.createElement('textarea');
        ta.className = 'val' + (row.badJSON ? ' badjson' : '');
        ta.value = row.value;
        ta.spellcheck = false;
        ta.addEventListener('input', () => {
            row.value = ta.value;
            checkJSON(row);
            ta.classList.toggle('badjson', !!row.badJSON);
            badge.classList.toggle('on', !!row.isJSON);
            fitArea(ta);
            updateDirty();
        });
        wrap.appendChild(badge);
        wrap.appendChild(ta);
        requestAnimationFrame(() => fitArea(ta));

        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '✕';
        del.title = '删除';
        del.addEventListener('click', () => {
            const arr = row.gl ? S.globalRows : S.rows;
            const i = arr.indexOf(row);
            if (i !== -1) arr.splice(i, 1);
            renderTable();
            renderDefaults();
            updateDirty();
        });

        div.appendChild(key);
        div.appendChild(wrap);
        div.appendChild(del);
        return div;
    }

    function renderDefaults() {
        const details = ref('defaults');
        const list = ref('dlist');
        list.textContent = '';
        if (S.defaults.length === 0) {
            details.style.display = 'none';
            return;
        }
        details.style.display = '';
        details.querySelector('summary').textContent =
            '未写入的默认变量 (' + S.defaults.length + ') — 来自角色/预设默认值,点击 ＋ 写入本聊天';
        for (const d of S.defaults) {
            const div = document.createElement('div');
            div.className = 'drow';
            const k = document.createElement('span');
            k.className = 'dkey';
            k.textContent = d.key;
            k.title = d.key;
            const v = document.createElement('span');
            v.className = 'dval';
            v.textContent = d.effective;
            v.title = d.effective;
            const add = document.createElement('button');
            add.className = 'dadd';
            add.textContent = '＋ 写入';
            add.addEventListener('click', () => {
                const val = d.effective === '(无法预读)' ? '' : d.effective;
                S.rows.push({ origKey: null, key: d.key, rawValue: '', value: pretty(val), isNew: true });
                S.defaults = S.defaults.filter((x) => x !== d);
                renderTable();
                renderDefaults();
                updateDirty();
            });
            div.appendChild(k);
            div.appendChild(v);
            div.appendChild(add);
            list.appendChild(div);
        }
    }

    function updateDirty() {
        const n = diffCount();
        const saveBtn = ref('save');
        saveBtn.disabled = n === 0;
        saveBtn.textContent = n === 0 ? '保存' : '保存 (' + n + ')';
        const st = ref('status');
        if (st.classList.contains('err')) return;
        if (n > 0) {
            st.textContent = n + ' 处未保存的更改';
        } else if (st.textContent.includes('未保存')) {
            st.textContent = '';
        }
    }

    function setStatus(text, isErr) {
        const st = ref('status');
        if (!st) return;
        st.textContent = text;
        st.classList.toggle('err', !!isErr);
    }

    let toastTimer = null;
    function toast(text) {
        const t = ref('toast');
        if (!t) return;
        t.textContent = text;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
    }

    async function openPanel() {
        buildUI();
        await risuai.showContainer('fullscreen');
        await reload();
    }

    await risuai.registerButton(
        { name: '变量面板', icon: '🧮', iconType: 'html', location: 'action', id: 'var-panel-fab' },
        openPanel
    );
    await risuai.registerButton(
        { name: '变量面板', icon: '🧮', iconType: 'html', location: 'chat', id: 'var-panel-menu' },
        openPanel
    );
})();
