const nodemailer = require('nodemailer');

function createTransport(account) {
    return nodemailer.createTransport({
        host: account.smtpHost || 'smtp.ukr.net',
        port: parseInt(account.smtpPort || '465'),
        secure: true,
        auth: {
            user: account.user,
            pass: account.password,
        },
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
    });
}

async function sendReply(account, to, subject, text) {
    const transport = createTransport(account);

    const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

    await transport.sendMail({
        from: account.user,
        to: to,
        subject: replySubject,
        text: text,
    });

    transport.close();
}

module.exports = { sendReply };
