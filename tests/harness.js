const fs = require('node:fs');
const vm = require('node:vm');

function loadHtml(htmlPath) {
  const elements = new Map();
  function element() {
    const listeners = {};
    return { value: '', textContent: '', innerHTML: '', style: {}, files: [],
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener(name, handler) { listeners[name] = handler; },
      appendChild() {}, remove() {}, click() { if (listeners.click) listeners.click({ target: this }); },
      querySelectorAll() { return []; }, getAttribute() { return null; }, setAttribute() {} };
  }
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }, createElement: element, body: element(), querySelectorAll() { return []; } };
  const window = { document };
  const context = vm.createContext({ window, document, console,
    FileReader: function () {}, Blob: function () {},
    URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} } });
  const script = fs.readFileSync(htmlPath, 'utf8').match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
  vm.runInContext(script, context, { filename: htmlPath });
  return { api: window.DpLatencyTraceTest, elements };
}
module.exports = { loadHtml };
