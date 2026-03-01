/* Tests for formatter module */
const { formatEmailMessage, formatDigest, formatStats, esc } = require('../lib/formatter');

let ok = 0, fail = 0;
function t(name, pass) { (pass ? ok++ : fail++); console.log((pass ? '  ✓' : '  ✗') + ' ' + name); }

// ─── esc() ───────────────────────────────────────────────────────
console.log('Testing esc()...');
t('escapes &', esc('A & B') === 'A &amp; B');
t('escapes <', esc('a < b') === 'a &lt; b');
t('escapes >', esc('a > b') === 'a &gt; b');
t('handles empty', esc('') === '');
t('handles null', esc(null) === '');
t('handles undefined', esc(undefined) === '');
t('mixed special chars', esc('<b>&</b>') === '&lt;b&gt;&amp;&lt;/b&gt;');

// ─── htmlToTelegramHtml() ────────────────────────────────────────
console.log('\nTesting htmlToTelegramHtml (via formatEmailMessage)...');

// Test via formatEmailMessage since htmlToTelegramHtml is not exported
// We test the full pipeline instead

const mockParsed = (html, text) => ({
    from: { value: [{ name: 'Test', address: 'test@example.com' }] },
    subject: 'Test Subject',
    date: new Date('2025-01-01T12:00:00Z'),
    html: html || null,
    text: text || null,
    attachments: [],
});

// Test bold preservation
const boldResult = formatEmailMessage(mockParsed('<b>Hello World</b>'), '');
t('preserves bold tags', boldResult.includes('<b>Hello World</b>'));

// Test italic preservation
const italicResult = formatEmailMessage(mockParsed('<em>Italic text</em>'), '');
t('converts em to i', italicResult.includes('<i>Italic text</i>'));

// Test heading → bold
const headingResult = formatEmailMessage(mockParsed('<h1>Big Title</h1>'), '');
t('converts h1 to bold', headingResult.includes('<b>Big Title</b>'));

// Test link handling
const linkResult = formatEmailMessage(mockParsed('<a href="https://example.com">Click here</a>'), '');
t('converts links', linkResult.includes('🔗') && linkResult.includes('Click here'));

// Test list items
const listResult = formatEmailMessage(mockParsed('<ul><li>Item 1</li><li>Item 2</li></ul>'), '');
t('converts lists to bullets', listResult.includes('•') && listResult.includes('Item 1'));

// Test tracking URL removal from links
const trackingResult = formatEmailMessage(mockParsed('<a href="https://example.com?utm_source=email&utm_medium=link">Link</a>'), '');
t('cleans tracking params from URLs', !trackingResult.includes('utm_source'));

// Test script removal
const scriptResult = formatEmailMessage(mockParsed('<script>alert("xss")</script>Hello'), '');
t('removes script tags', !scriptResult.includes('alert'));
t('keeps text after script', scriptResult.includes('Hello'));

// Test style removal
const styleResult = formatEmailMessage(mockParsed('<style>.red{color:red}</style>Hello'), '');
t('removes style tags', !styleResult.includes('.red'));

// Test image with alt text
const imgResult = formatEmailMessage(mockParsed('<img alt="Photo of cat" src="cat.jpg">'), '');
t('converts img with alt to emoji', imgResult.includes('🖼') && imgResult.includes('Photo of cat'));

// Test empty body
const emptyResult = formatEmailMessage(mockParsed(''), '');
t('handles empty body', emptyResult.includes('порожнє повідомлення'));

// Test plain text fallback
const plainResult = formatEmailMessage(mockParsed(null, 'Just plain text here'), '');
t('uses plain text when no HTML', plainResult.includes('Just plain text here'));

// Test subject in output
const subjectResult = formatEmailMessage(mockParsed('<p>Body</p>'), '');
t('includes subject', subjectResult.includes('Test Subject'));

// Test from info in output
t('includes from email', subjectResult.includes('test@example.com'));
t('includes from name', subjectResult.includes('Test'));

// Test attachments
const withAttachments = {
    ...mockParsed('<p>Body</p>'),
    attachments: [{ filename: 'doc.pdf', size: 1024 * 500 }],
};
const attachResult = formatEmailMessage(withAttachments, '');
t('shows attachment info', attachResult.includes('📎') && attachResult.includes('doc.pdf'));
t('shows attachment size', attachResult.includes('КБ'));

// Test account label
const accountResult = formatEmailMessage(mockParsed('<p>Body</p>'), 'work@office.com');
t('includes account label', accountResult.includes('work@office.com'));

// ─── cleanPlainText ──────────────────────────────────────────────
console.log('\nTesting plain text cleanup...');

const longUrlText = `Hello\nhttps://example.com/very/long/path/that/goes/on/and/on/and/on/and/on/for/ever/and/ever/and/ever/more?param=value&another=value\nWorld`;
const plainCleanResult = formatEmailMessage(mockParsed(null, longUrlText), '');
t('handles long URLs in plain text', plainCleanResult.includes('Hello'));

// ─── formatDigest() ──────────────────────────────────────────────
console.log('\nTesting formatDigest()...');

const emptyDigest = formatDigest({ count: 0, senders: {}, subjects: [] }, '2025-01-01');
t('empty digest says no emails', emptyDigest.includes('Листів не було'));

const filledDigest = formatDigest({
    count: 5,
    senders: { 'a@b.com': 3, 'c@d.com': 2 },
    subjects: ['Subject 1', 'Subject 2'],
}, '2025-01-01');
t('filled digest shows count', filledDigest.includes('5'));
t('filled digest shows sender', filledDigest.includes('a@b.com'));
t('filled digest shows subjects', filledDigest.includes('Subject 1'));

// ─── formatStats() ───────────────────────────────────────────────
console.log('\nTesting formatStats()...');

const stats = formatStats(
    { totalCount: 10, topSenders: [['a@b.com', 5]], totalAll: 100 },
    { totalCount: 50, topSenders: [['a@b.com', 20], ['c@d.com', 15]], totalAll: 100 },
    { totalCount: 200, topSenders: [['a@b.com', 80]], totalAll: 100 },
);
t('stats shows today count', stats.includes('10'));
t('stats shows week count', stats.includes('50'));
t('stats shows month count', stats.includes('200'));
t('stats shows top sender', stats.includes('a@b.com'));

// ─── Summary ─────────────────────────────────────────────────────
console.log(`\nDone: ${ok} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
