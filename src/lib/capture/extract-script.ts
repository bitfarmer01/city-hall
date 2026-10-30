/**
 * The in-page form-field extractor, as a plain-JS script string.
 *
 * Why a string and not a function passed to page.evaluate: the extractor is
 * serialized into the browser, where nothing exists except this source. Any
 * Node-side transform (tsx/esbuild injects __name(...) helpers into named
 * functions) would reference a helper the browser does not have, and the
 * evaluate call dies with "ReferenceError: __name is not defined" — found
 * live on the first real capture. A string is never transformed, and the
 * driver tests execute it in real chromium on every run, so a syntax error
 * here fails loudly.
 *
 * It must stay self-contained: no imports, no closure references. Returns
 * attribute data only; it never reads or sets input values, focuses
 * anything, or dispatches events.
 */
export const EXTRACT_FIELDS_SCRIPT = `(function extractFieldsInPage() {
  var MAX = 100;

  function text(s) {
    return typeof s === "string" ? s.trim() : "";
  }

  function labelFor(el) {
    var input = el;
    if (input.id) {
      var lab = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (lab && lab.textContent) return lab.textContent.trim();
    }
    var ariaLabel = input.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    var labelledBy = input.getAttribute("aria-labelledby");
    if (labelledBy) {
      var parts = labelledBy.split(/\\s+/).map(function (ref) {
        var t = document.getElementById(ref);
        return t && t.textContent ? t.textContent.trim() : "";
      }).filter(function (t) { return t.length > 0; });
      if (parts.length > 0) return parts.join(" ");
    }
    var wrap = input.closest("label");
    if (wrap && wrap.textContent) return wrap.textContent.trim();
    var placeholder = input.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    var title = input.getAttribute("title");
    return title ? title.trim() : "";
  }

  function field(el, tag) {
    var input = el;
    var label = labelFor(el);
    var typeAttr = tag === "input" ? (input.getAttribute("type") || "text").toLowerCase() : null;
    var type = tag === "input" ? typeAttr : tag === "select" ? "select-one" : "textarea";
    var options = [];
    var optionsTotal = 0;
    if (tag === "select") {
      var opts = el.options;
      for (var i = 0; i < opts.length; i++) {
        optionsTotal += 1;
        if (options.length < MAX) options.push(opts[i].text.trim());
      }
    } else if (type === "radio" || type === "checkbox") {
      optionsTotal = 1;
      var value = input.getAttribute("value");
      if (value) options.push(value.trim());
    }
    return {
      tag: tag,
      type: type,
      name: input.getAttribute("name") || "",
      id: input.id || "",
      label: label,
      required: input.hasAttribute("required") || input.getAttribute("aria-required") === "true",
      requiredMarker: label.indexOf("*") !== -1 || (input.getAttribute("placeholder") || "").indexOf("*") !== -1,
      options: options,
      optionsTotal: optionsTotal,
      accept: input.getAttribute("accept"),
      multiple: input.hasAttribute("multiple")
    };
  }

  var fields = [];
  var inputs = document.querySelectorAll("input");
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    var t = (el.getAttribute("type") || "text").toLowerCase();
    // Attribute-only inventory: buttons and hidden inputs are not form fields
    // an applicant fills; submit buttons are recorded separately below.
    if (t === "submit" || t === "button" || t === "image" || t === "hidden" || t === "reset") continue;
    fields.push(field(el, "input"));
  }
  var textareas = document.querySelectorAll("textarea");
  for (var j = 0; j < textareas.length; j++) fields.push(field(textareas[j], "textarea"));
  var selects = document.querySelectorAll("select");
  for (var k = 0; k < selects.length; k++) fields.push(field(selects[k], "select"));

  var submitButtons = [];
  var buttons = document.querySelectorAll("button, input[type=submit]");
  for (var b = 0; b < buttons.length; b++) {
    var label = buttons[b] instanceof HTMLInputElement ? (buttons[b].value || "") : (buttons[b].innerText || "");
    var trimmed = text(label).replace(/\\s+/g, " ");
    if (trimmed) submitButtons.push(trimmed);
  }

  return { fields: fields, submitButtons: submitButtons };
})();`;
