import { extension_settings, getContext } from '../../../extensions.js';
import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    updateMessageBlock,
    saveChatConditional,
} from '../../../../script.js';

const MODULE = 'ru_linebreak_fix';
const defaults = { enabled: true, userMessages: false };

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
                <input type="checkbox" id="rulf_enabled" ${s.enabled ? 'checked' : ''}>
                <span>Автоисправление ответов ИИ</span>
            </label>
            <label class="checkbox_label rulf-row">
                <input type="checkbox" id="rulf_user" ${s.userMessages ? 'checked' : ''}>
                <span>Исправлять и мои сообщения</span>
            </label>
            <div class="menu_button" id="rulf_fix_all">Исправить весь текущий чат</div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#rulf_enabled').on('change', function () { getSettings().enabled = this.checked; saveSettingsDebounced(); });
    $('#rulf_user').on('change', function () { getSettings().userMessages = this.checked; saveSettingsDebounced(); });
    $('#rulf_fix_all').on('click', fixWholeChat);
}

jQuery(() => {
    buildUI();
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (id) => {
        if (await fixMessage(id)) await saveChatConditional();
    });
    eventSource.on(event_types.MESSAGE_UPDATED, async (id) => {
        if (await fixMessage(id)) await saveChatConditional();
    });
});
