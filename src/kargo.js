function trackingLink(settings, number) {
  if (!number) return '';
  const base = (settings && settings.cargoTrackingUrl) || 'https://gonderitakip.suratkargo.com.tr/Sorgu/';
  return base + encodeURIComponent(String(number));
}

module.exports = { trackingLink };
