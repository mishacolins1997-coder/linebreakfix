import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
    saveChatConditional,
} from '../../../../script.js';

const MODULE = 'ru_linebreak_fix';
const defaults = { enabled: true, userMessages: false, cssFix: true };

// Короткие слова, после которых перенос = пробел (а не разрыв слова)
const STOP = new Set((
    'в во и а но да не ни на по за из от до со ко ус об о у к с я мы вы он она оно они ' +
    'же ли бы то та те ту том как что это эта эти для при про без над под или его ее её их ' +
    'все всё был была были мне мой моя тут там вот так уже ещё еще еле'
).split(' '));

function getSettings() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = {};
    for (const k in defaults) {
        if (extension_settings[MODULE][k] === undefined) extension_settings[MODULE][k] = defaults[k];
    }
    return extension_settings[MODULE];
}

function fixChunk(text) {
    let t = text;

    // 0) Нестандартные переводы строк и невидимые символы, дающие разрыв внутри слова
    t = t.replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n');
    t = t.replace(/[\u00AD\u200B\u200C\u2060\uFEFF]/g, '');
    t = t.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');

    // 1) Перенос + пробелы в начале следующей строки → один пробел ("со\n свежим")
    t = t.replace(/([^\s])[ \t]*\n[ \t]+(?=[а-яёa-z])/g, '$1 ');

    // 2) Одиночный перенос перед строчной буквой:
    //    после знака препинания / короткого слова → пробел, иначе слово разорвано → склеить
    t = t.replace(/([^\s]+)\n(?=[а-яё])/g, (m, word) => {
        if (/[,;:.!?…—–\-»)"]$/.test(word)) return word + ' ';
        const letters = word.replace(/[^а-яёa-z]/gi, '');
        const lower = letters.toLowerCase();
        const capitalized = letters[0] && letters[0] !== lower[0];
        if (STOP.has(lower)) return word + ' ';
        if (capitalized && letters.length <= 3) return word + ' ';
        if (letters.length <= 2) return word + ' ';
        return word; // склейка внутри слова
    });

    return t;
}

export function fixText(text) {
    if (!text || typeof text !== 'string') return text;
    // Не трогаем блоки кода
    return text.split(/(```[\s\S]*?```)/g)
        .map((part, i) => (i % 2 ? part : fixChunk(part)))
        .join('');
}

async function fixMessage(id) {
    const s = getSettings();
    if (!s.enabled) return false;
    const { chat } = getContext();
    const msg = chat[id];
    if (!msg || typeof msg.mes !== 'string') return false;
    if (msg.is_user && !s.userMessages) return false;
    if (msg.is_system) return false;

    const fixed = fixText(msg.mes);
    if (fixed === msg.mes) return false;

    msg.mes = fixed;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = fixed;
    }
    updateMessageBlock(id, msg);
    return true;
}

async function fixWholeChat() {
    const { chat } = getContext();
    let n = 0;
    for (let i = 0; i < chat.length; i++) {
        if (await fixMessage(i)) n++;
    }
    if (n) await saveChatConditional();
    toastr.success(`Исправлено сообщений: ${n}`, 'RU Linebreak Fix');
}

function diagnose() {
    const { chat } = getContext();
    let msg = null;
    for (let i = chat.length - 1; i >= 0; i--) { if (!chat[i].is_user && !chat[i].is_system) { msg = chat[i]; break; } }
    if (!msg) { toastr.warning('Нет сообщений ИИ', 'RU Linebreak Fix'); return; }
    const counts = {};
    for (const ch of msg.mes) {
        const c = ch.codePointAt(0);
        const odd = c < 32 || (c >= 0x7f && c <= 0xa0) || c === 0xad || (c >= 0x2000 && c <= 0x206f) || c === 0xfeff || c === 0x3000;
        if (odd) { const k = 'U+' + c.toString(16).toUpperCase().padStart(4, '0'); counts[k] = (counts[k] || 0) + 1; }
    }
    const report = Object.keys(counts).length
        ? Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(', ')
        : 'нестандартных символов нет';
    console.log('[RU Linebreak Fix] raw message:', JSON.stringify(msg.mes));
    toastr.info(`Спец-символы: ${report}. Сырой текст выведен в консоль (F12).`, 'RU Linebreak Fix', { timeOut: 20000 });
}

function applyCss() {
    document.body.classList.toggle('rulf-css-fix', !!getSettings().cssFix);
}

function buildUI() {
    const s = getSettings();
    const html = `
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>RU Linebreak Fix</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label rulf-row">
                <input type="checkbox" id="rulf_css" ${s.cssFix ? 'checked' : ''}>
                <span>Запретить перенос посреди слова (CSS-исправление)</span>
            </label>
            <label class="checkbox_label rulf-row">
                <input type="checkbox" id="rulf_enabled" ${s.enabled ? 'checked' : ''}>
                <span>Автоисправление ответов ИИ</span>
            </label>
            <label class="checkbox_label rulf-row">
                <input type="checkbox" id="rulf_user" ${s.userMessages ? 'checked' : ''}>
                <span>Исправлять и мои сообщения</span>
            </label>
            <div class="menu_button" id="rulf_diag">Диагностика последнего ответа</div>
            <div class="menu_button" id="rulf_fix_all">Исправить весь текущий чат</div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#rulf_css').on('change', function () { getSettings().cssFix = this.checked; applyCss(); saveSettingsDebounced(); });
    $('#rulf_enabled').on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
    $('#rulf_user').on('change', function () { getSettings().userMessages = this.checked; saveSettingsDebounced(); });
    $('#rulf_fix_all').on('click', fixWholeChat);
    $('#rulf_diag').on('click', diagnose);
}

jQuery(() => {
    buildUI();
    applyCss();
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (id) => {
        if (await fixMessage(id)) await saveChatConditional();
    });
    eventSource.on(event_types.MESSAGE_UPDATED, async (id) => {
        if (await fixMessage(id)) await saveChatConditional();
    });
});
