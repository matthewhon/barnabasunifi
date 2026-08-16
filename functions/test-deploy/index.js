const { initializeApp } = require('firebase-admin/app');
initializeApp();

const { onCall } = require('firebase-functions/v2/https');

exports.healthCheck = onCall((request) => {
  return { ok: true, ts: new Date().toISOString() };
});
