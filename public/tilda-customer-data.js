(function () {
  'use strict';
  if (window.__pricpayCustomerBridge) return;
  var script = document.currentScript;
  if (!script || !script.src) return;
  var gateway = new URL(script.src).origin;
  var orders = new Map();
  var nativeSubmit = HTMLFormElement.prototype.submit;
  window.__pricpayCustomerBridge = true;
  var diagnostics = window.__pricpayCustomerDiagnostics = {
    version: '2026-10-21.1', stage: 'ready', successEvents: 0, capturedOrders: 0,
    cartOrderFormat: 'not-seen', paymentOrderFormat: 'not-seen', matched: false,
    code: null, status: null, field: null
  };

  function recordStage(stage, details) {
    Object.assign(diagnostics, { stage: stage, code: null, status: null, field: null }, details);
  }

  function orderFormat(orderId) {
    if (!orderId) return 'missing';
    if (/^[1-9]\d*:[1-9]\d*$/.test(orderId)) return 'project:order';
    if (/^[1-9]\d*$/.test(orderId)) return 'order-only';
    return 'other';
  }

  function checkoutError(code) {
    var error = new Error(code);
    error.bridgeCode = code;
    return error;
  }

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
    diagnostics.successEvents++;
    recordStage('capturing', { cartOrderFormat: orderFormat(form.tildaOrderId), matched: false });
    var allRecords = document.getElementById('allrecords');
    var projectId = allRecords ? allRecords.getAttribute('data-tilda-project-id') : '';
    var orderId = canonicalOrderId(form.tildaOrderId, projectId);
    if (!orderId) { recordStage('capture-skipped', { code: 'CART_ORDER_MISSING' }); return; }
    if (orders.has(orderId)) { recordStage('captured'); return; }
    try {
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
      recordStage('captured', { capturedOrders: orders.size });
    } catch (_) {
      recordStage('capture-failed', { code: 'CAPTURE_FAILED' });
    }
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
      return response.json().catch(function () {
        var error = checkoutError('UPLOAD_RESPONSE');
        error.httpStatus = response.status;
        throw error;
      }).then(function (body) {
        if (!response.ok || !body || body.ok !== true) {
          var error = checkoutError('UPLOAD_REJECTED');
          error.httpStatus = response.status;
          if (body && Object.prototype.hasOwnProperty.call(customerFieldTitles, body.field)) {
            error.bridgeCode = 'CUSTOMER_FIELD';
            error.customerField = body.field;
            error.checkoutMessage = '\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u043b\u0435 \u00ab' + customerFieldTitles[body.field] + '\u00bb. ' +
              (body.field === 'customerCountry' ? '\u0414\u043b\u044f \u0420\u043e\u0441\u0441\u0438\u0438 \u043c\u043e\u0436\u043d\u043e \u0443\u043a\u0430\u0437\u0430\u0442\u044c \u00ab\u0420\u043e\u0441\u0441\u0438\u044f\u00bb \u0438\u043b\u0438 RU. ' : '') + '\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u044c\u0442\u0435 \u0437\u0430\u043a\u0430\u0437 \u0441\u043d\u043e\u0432\u0430.';
          }
          throw error;
        }
      });
    }).finally(function () { clearTimeout(timeout); });
  }

  var customerFieldTitles = {
    firstName: '\u0418\u043c\u044f',
    lastName: '\u0424\u0430\u043c\u0438\u043b\u0438\u044f',
    customerCountry: '\u0421\u0442\u0440\u0430\u043d\u0430',
    state: '\u0420\u0435\u0433\u0438\u043e\u043d',
    city: '\u0413\u043e\u0440\u043e\u0434',
    address: '\u0410\u0434\u0440\u0435\u0441',
    zip: '\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u0438\u043d\u0434\u0435\u043a\u0441',
    email: 'Email',
    phone: '\u0422\u0435\u043b\u0435\u0444\u043e\u043d'
  };

  function reportFailure(error) {
    var code = error.bridgeCode || (error.name === 'AbortError' ? 'UPLOAD_TIMEOUT' : 'UPLOAD_NETWORK');
    recordStage('failed', { code: code, status: error.httpStatus || null, field: error.customerField || null });
    console.warn('PricPay customer bridge', JSON.stringify(diagnostics));
    var suffix = ' [PD_' + code + ']';
    if (error.checkoutMessage) { window.alert(error.checkoutMessage + suffix); return; }
    window.alert('\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0435\u0440\u0435\u0434\u0430\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435 \u0437\u0430\u043a\u0430\u0437\u0430. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u043b\u044f \u043a\u043e\u0440\u0437\u0438\u043d\u044b, \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.' + suffix);
  }

  function submitGatewayForm(form) {
    var fields = new FormData(form);
    var orderId = formValue(fields, ['orderid', 'orderId', 'order_number', 'orderNumber', 'id']);
    var entry = orders.get(orderId);
    var captureFailure = diagnostics.code;
    recordStage('payment-received', { paymentOrderFormat: orderFormat(orderId), matched: !!entry });
    if (!entry) {
      var code = captureFailure === 'CAPTURE_FAILED' || captureFailure === 'CART_ORDER_MISSING'
        ? captureFailure : 'ORDER_NOT_CAPTURED';
      reportFailure(checkoutError(!orderId ? 'PAYMENT_ORDER_MISSING' : code));
      return;
    }
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
    recordStage('uploading');
    entry.ready = entry.ready || upload(orderId, entry);
    entry.ready.then(function () {
      recordStage('payment-submitted');
      document.body.appendChild(paymentForm);
      nativeSubmit.call(paymentForm);
    }).catch(function (error) {
      entry.submitted = false;
      entry.ready = null;
      reportFailure(error);
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
