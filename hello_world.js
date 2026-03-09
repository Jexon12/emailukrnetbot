const fs = require('fs');
fs.writeFileSync('hello.txt', 'HELLO WORLD ' + new Date().toISOString());
console.log('done');
