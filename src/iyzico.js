const crypto = require('crypto');

function hmac(apiKey, secretKey, rnd, tstamp, body) {
  const payload = apiKey + rnd + tstamp + secretKey + body;
  return crypto.createHash('sha256').update(payload).digest('base64');
}

function authHeaders(apiKey, secretKey, body) {
  const rnd = crypto.randomBytes(16).toString('hex');
  const tstamp = String(Date.now());
  const signature = hmac(apiKey, secretKey, rnd, tstamp, body);
  return {
    'Content-Type': 'application/json',
    'Authorization': 'IYZWS ' + apiKey + ':' + signature,
    'x-iyzi-rnd': rnd,
    'x-iyzi-tstamp': tstamp
  };
}

function esc(s) {
  return String(s).replace(/"/g, '\\"');
}

async function initialize(settings, order, customer, basketItems, callbackUrl) {
  const iyz = settings.iyzico;
  if (!iyz.apiKey || !iyz.secretKey) {
    throw new Error('iyzico ayarları eksik');
  }

  const bodyObj = {
    locale: 'tr',
    conversationId: order.id,
    price: String(order.total),
    paidPrice: String(order.total),
    currency: 'TRY',
    basketId: order.orderNo,
    paymentGroup: 'PRODUCT',
    callbackUrl: callbackUrl,
    buyer: {
      id: customer.idNumber || '12345678901',
      name: (customer.name || '').split(' ')[0] || 'Musteri',
      surname: (customer.name || '').split(' ').slice(1).join(' ') || 'Musteri',
      gsNumber: customer.phone || '+900000000000',
      email: customer.email || 'musteri@ornek.com',
      identityNumber: customer.idNumber || '12345678901',
      registrationAddress: customer.address || 'Adres',
      city: customer.city || 'Istanbul',
      country: 'Turkey',
      ip: customer.ip || '85.34.78.112'
    },
    shippingAddress: {
      contactName: customer.name || 'Musteri',
      city: customer.city || 'Istanbul',
      country: 'Turkey',
      address: customer.address || 'Adres',
      zipCode: customer.zipCode || '34000'
    },
    billingAddress: {
      contactName: customer.name || 'Musteri',
      city: customer.city || 'Istanbul',
      country: 'Turkey',
      address: customer.address || 'Adres',
      zipCode: customer.zipCode || '34000'
    },
    basketItems: basketItems.map(b => ({
      id: b.id,
      name: b.name,
      category1: b.category || 'Genel',
      category2: b.category || 'Genel',
      itemType: 'PHYSICAL',
      price: String(b.price)
    }))
  };

  const body = JSON.stringify(bodyObj);
  const headers = authHeaders(iyz.apiKey, iyz.secretKey, body);
  const url = (iyz.baseUrl || 'https://sandbox-api.iyzico.com') + '/payment/iyzipos/checkoutform/initialize/auth/ecom';

  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json().catch(() => null);
  if (!res.ok || (data && data.status !== 'success')) {
    throw new Error('iyzico hata: ' + ((data && (data.errorMessage || data.errorCode)) || res.status));
  }
  return data;
}

async function getPaymentDetail(settings, conversationId, token) {
  const iyz = settings.iyzico;
  const body = JSON.stringify({ locale: 'tr', conversationId, token });
  const headers = authHeaders(iyz.apiKey, iyz.secretKey, body);
  const url = (iyz.baseUrl || 'https://sandbox-api.iyzico.com') + '/payment/iyzipos/checkoutform/auth/ecom/detail';
  const res = await fetch(url, { method: 'POST', headers, body });
  const data = await res.json().catch(() => null);
  return data;
}

module.exports = { initialize, getPaymentDetail };
