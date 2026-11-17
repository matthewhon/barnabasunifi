import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * HTTP Cloud Function: postmarkWebhook
 * Receives Postmark delivery/bounce/spam-complaint webhook events for auditing.
 */
export const postmarkWebhook = onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    return;
  }

  const body = req.body ?? {};
  const recordType = String(body.RecordType || 'Unknown');
  const messageId = String(body.MessageID || '');
  const email = String(body.Email || body.Recipient || '');

  try {
    const db = getFirestore();
    await db.collection('postmark_webhooks').add({
      record_type: recordType,
      message_id: messageId,
      email,
      tag: body.Tag || null,
      description: body.Description || body.Details || null,
      bounced_at: body.BouncedAt || null,
      received_at: FieldValue.serverTimestamp(),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Failed to process Postmark webhook:', err);
    res.status(500).json({ ok: false });
  }
});
