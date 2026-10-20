(function () {
  'use strict';
  if (window.__pricpayCustomerBridge) return;
  var script = document.currentScript;
  if (!script || !script.src) return;
  var gateway = new URL(script.src).origin;
  var orders = new Map();
  var nativeSubmit = HTMLFormElement.prototype.submit;
  window.__pricpayCustomerBridge = true;

  function canonicalOrderId(value, projectId) {
    value = String(value || '');
    if (/^[1-9]\d*:[1-9]\d*$/.test(value)) return value;
    if (/^[1-9]\d*$/.test(value) && /^[1-9]\d*$/.test(projectId)) return projectId + ':' + value;
    return '';
  }

  function formValue(fields, names) {
    for (var i = 0; i < names.length; i++) {
      var value = fields.get(names[i]);
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function captureOrder(event) {
    var form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    var allRecords = document.getElementById('allrecords');
    var projectId = allRecords ? allRecords.getAttribute('data-tilda-project-id') : '';
    var orderId = canonicalOrderId(form.tildaOrderId, projectId);
    if (!orderId || orders.has(orderId)) return;
    var fields = new FormData(form);
    var customer = {};
    ['firstName', 'lastName', 'customerCountry', 'state', 'city', 'address', 'zip'].forEach(function (name) {
      customer[name] = formValue(fields, [name]);
    });
    customer.email = formValue(fields, ['email', 'Email']);
    customer.phone = formValue(fields, ['phone', 'Phone']);
    var bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    var token = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    orders.set(orderId, { token: token, customer: customer, submitted: false, ready: null });
  }

  function isGatewayForm(form) {
    var url;
    try { url = new URL(form.action, document.baseURI); } catch (_) { return false; }
    return url.origin === gateway && /^\/api\/pricpay\/(cashier|create)$/.test(url.pathname);
  }

  function upload(orderId, entry) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 10000);
    return fetch(gateway + '/api/tilda/customer-data', {
      method: 'POST', credentials: 'omit', keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      signal: controller.signal,
      body: JSON.stringify({ orderId: orderId, token: entry.token, customer: entry.customer })
    }).then(function (response) {
      if (!response.ok) throw new Error('Customer data was not accepted');
      return response.json();
    }).then(function (body) {
      if (!body.ok) throw new Error('Customer data was not saved');
    }).finally(function () { clearTimeout(timeout); });
  }

  function reportFailure() {
    window.alert('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0435\u0440\u0435\u0434\u0430\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435 \u0437\u0430\u043a\u0430\u0437\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u043b\u044f \u043a\u043e\u0440\u0437\u0438\u043d\u044b, \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.');
  }

  function submitGatewayForm(form) {
    var fields = new FormData(form);
    var orderId = formValue(fields, ['orderid', 'orderId', 'order_number', 'orderNumber', 'id']);
    var entry = orders.get(orderId);
    if (!entry) { reportFailure(); return; }
    if (entry.submitted) return;
    entry.submitted = true;
    // Snapshot the hidden payment form in case Tilda removes its original after submit().
    var paymentForm = form.cloneNode(true);
    paymentForm.removeAttribute('id');
    paymentForm.hidden = true;
    var tokenInput = paymentForm.querySelector('input[name="customerDataToken"]');
    if (!tokenInput) {
      tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = 'customerDataToken';
      paymentForm.appendChild(tokenInput);
    }
    tokenInput.value = entry.token;
    entry.ready = entry.ready || upload(orderId, entry);
    entry.ready.then(function () {
      document.body.appendChild(paymentForm);
      nativeSubmit.call(paymentForm);
    }).catch(function () {
      entry.submitted = false;
      entry.ready = null;
      reportFailure();
    });
  }

  document.addEventListener('tildaform:aftersuccess', captureOrder, true);
  document.addEventListener('submit', function (event) {
    if (event.target instanceof HTMLFormElement && isGatewayForm(event.target)) {
      event.preventDefault();
      submitGatewayForm(event.target);
    }
  }, true);
  // Native form.submit() bypasses submit events; scope this wrapper to our payment URLs.
  HTMLFormElement.prototype.submit = function () {
    if (isGatewayForm(this)) { submitGatewayForm(this); return; }
    return nativeSubmit.apply(this, arguments);
  };
}());
