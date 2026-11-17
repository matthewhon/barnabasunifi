import { formatInTimeZone } from 'date-fns-tz';

export interface BaseEmailLayoutOptions {
  orgName?: string;
  logoUrl?: string;
  title: string;
  preheader?: string;
  bodyHtml: string;
  cta?: {
    label: string;
    url: string;
  };
  footerText?: string;
  portalUrl?: string;
}

/** Escapes HTML special characters to prevent injection in email templates. */
export function escapeHtml(value: string | undefined | null): string {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formats an ISO timestamp or Date in the organization's timezone. */
export function formatDateInTz(
  value: string | Date | number,
  timeZone = 'America/Chicago',
  pattern = 'EEE, MMM d, yyyy h:mm a zzz'
): string {
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return formatInTimeZone(date, timeZone || 'America/Chicago', pattern);
  } catch {
    return new Date(value).toLocaleString();
  }
}

/**
 * Renders a responsive, email-client-safe HTML layout with optional tenant logo and footer.
 */
export function renderBaseEmailLayout(opts: BaseEmailLayoutOptions): string {
  const {
    orgName = 'UnFi-PCO',
    logoUrl,
    title,
    preheader,
    bodyHtml,
    cta,
    footerText,
    portalUrl,
  } = opts;

  const safeOrg = escapeHtml(orgName);
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || title);

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${safeOrg}" style="max-height:56px;max-width:220px;width:auto;height:auto;display:block;margin:0 auto 12px auto;border:0;" />`
    : '';

  const ctaBlock = cta?.url
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
        <tr>
          <td align="center" bgcolor="#2563eb" style="border-radius:8px;">
            <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${escapeHtml(cta.label)}
            </a>
          </td>
        </tr>
      </table>
    `
    : '';

  const tenantFooter = footerText
    ? `<p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#64748b;">${escapeHtml(footerText).replace(/\n/g, '<br/>')}</p>`
    : '';

  const portalLink = portalUrl
    ? `<a href="${escapeHtml(portalUrl)}" style="color:#2563eb;text-decoration:none;">Open ${safeOrg} Portal</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${safePreheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:28px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td align="center" style="padding:24px 28px 18px 28px;border-bottom:1px solid #e2e8f0;background-color:#f8fafc;">
              ${logoBlock}
              <div style="font-size:14px;font-weight:600;color:#475569;letter-spacing:0.02em;">${safeOrg}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;font-weight:700;color:#0f172a;">${safeTitle}</h1>
              <div style="font-size:14px;line-height:1.6;color:#334155;">
                ${bodyHtml}
              </div>
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background-color:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              ${tenantFooter}
              <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                Sent by ${safeOrg} via UnFi-PCO${portalLink ? ` &bull; ${portalLink}` : ''}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
