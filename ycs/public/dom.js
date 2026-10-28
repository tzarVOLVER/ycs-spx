// Small DOM primitives shared by the mapping and collection views.
window.YCSMappingDOM = Object.freeze({
  node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  },
  option(select, value, text) {
    const option = window.YCSMappingDOM.node('option', text);
    option.value = value;
    select.append(option);
  },
  control(options, value, label) {
    const select = document.createElement('select');
    for (const [key, text] of options) window.YCSMappingDOM.option(select, key, text);
    select.value = value;
    if (label) select.setAttribute('aria-label', label);
    return select;
  },
  fieldLabel(title, control) {
    const label = window.YCSMappingDOM.node('label', title);
    label.append(control);
    return label;
  }
});
