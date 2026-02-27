// Auto-categorize emails based on sender and subject keywords

const CATEGORIES = [
    {
        emoji: '🏦',
        name: 'Банк/Фінанси',
        keywords: ['банк', 'bank', 'приват', 'privat', 'mono', 'monobank', 'оплата', 'payment', 'рахунок', 'invoice', 'транзакц', 'переказ', 'баланс', 'картк'],
    },
    {
        emoji: '🛒',
        name: 'Покупки',
        keywords: ['замовлення', 'order', 'delivery', 'доставк', 'покупк', 'чек', 'receipt', 'rozetka', 'prom.ua', 'aliexpress', 'amazon', 'olx', 'nova poshta', 'нова пошта', 'укрпошта', 'відправлен'],
    },
    {
        emoji: '🔑',
        name: 'Безпека/OTP',
        keywords: ['код підтвердження', 'verification code', 'otp', 'password', 'пароль', 'security', 'безпек', 'двофакторн', '2fa', 'підтверд', 'verify', 'confirm', 'reset password', 'зміна паролю', 'вхід', 'sign in', 'login'],
    },
    {
        emoji: '📢',
        name: 'Розсилки',
        keywords: ['newsletter', 'розсилк', 'unsubscribe', 'відписатися', 'subscription', 'підписк', 'promo', 'промо', 'знижк', 'discount', 'sale', 'акція', 'offer', 'пропозиц', 'marketing', 'digest', 'weekly', 'щотижн'],
    },
    {
        emoji: '💼',
        name: 'Робота',
        keywords: ['resume', 'резюме', 'вакансі', 'job', 'interview', 'співбесід', 'hr', 'hiring', 'offer letter', 'робота', 'зарплат', 'salary'],
    },
    {
        emoji: '🎓',
        name: 'Навчання',
        keywords: ['university', 'університет', 'інститут', 'курс', 'course', 'лекці', 'розклад', 'schedule', 'student', 'студент', 'homework', 'завдання', 'exam', 'іспит', 'залік', 'зарахуван'],
    },
    {
        emoji: '🌐',
        name: 'Соцмережі',
        keywords: ['facebook', 'instagram', 'twitter', 'linkedin', 'telegram', 'youtube', 'tiktok', 'viber', 'whatsapp', 'discord', 'github', 'google', 'apple'],
    },
];

function categorize(subject, from, body) {
    const text = `${subject} ${from} ${(body || '').substring(0, 500)}`.toLowerCase();
    const matched = [];

    for (const cat of CATEGORIES) {
        if (cat.keywords.some(kw => text.includes(kw))) {
            matched.push(cat);
        }
    }

    return matched.length > 0 ? matched[0] : { emoji: '✉️', name: 'Інше' };
}

module.exports = { categorize, CATEGORIES };
