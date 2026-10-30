'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const publicRoot = path.resolve(__dirname, '../../public');

// Follow production script order, so a missing dependency fails UI tests too.
async function loadDataManagerScripts(window) {
  for (const script of window.document.querySelectorAll('script[src]')) {
    if (!script.getAttribute('src').startsWith('/ycs/') || script.type === 'module') continue;
    const file = path.resolve(publicRoot, script.getAttribute('src').slice('/ycs/'.length));
    if (!file.startsWith(publicRoot + path.sep)) throw new Error('Invalid test script path');
    window.eval(await fs.readFile(file, 'utf8'));
  }
}

async function loadContract(window) {
  window.eval(await fs.readFile(path.join(publicRoot, 'data-contract.js'), 'utf8'));
}
module.exports = { loadDataManagerScripts, loadContract };
