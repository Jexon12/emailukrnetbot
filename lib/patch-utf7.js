const fs = require('fs');

function patch() {
    try {
        const utf7Path = require.resolve('utf7');
        let code = fs.readFileSync(utf7Path, 'utf8');
        let changed = false;

        if (code.includes("new Buffer(str.length * 2, 'ascii')")) {
            code = code.replace("new Buffer(str.length * 2, 'ascii')", "(Buffer.alloc ? Buffer.alloc(str.length * 2) : new Buffer(str.length * 2, 'ascii'))");
            changed = true;
        }

        if (code.includes("new Buffer(str, 'base64')")) {
            code = code.replace("new Buffer(str, 'base64')", "(Buffer.from ? Buffer.from(str, 'base64') : new Buffer(str, 'base64'))");
            changed = true;
        }

        if (changed) {
            fs.writeFileSync(utf7Path, code, 'utf8');
            console.log('[INFO] 🛠️ utf7 module patched for Node.js 16+ Buffer API');
        }
    } catch (err) {
        console.error('[WARN] Failed to patch utf7 module:', err.message);
    }
}

module.exports = patch;
