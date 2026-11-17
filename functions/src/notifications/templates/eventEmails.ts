import { escapeHtml, formatDateInTz } from './baseLayout';

export interface EventSummaryItem {
  title: string;
  startsAt: string;
  endsAt?: string;
  sourceType: string;
  doorLabels?: string[];
  unlockAt?: string;
  lockAt?: string;
}

export function buildUnmappedEventsEmail(params: {
  orgName: string;
  unmappedCount: number;
  urgentEvents: EventSummaryItem[];
  upcomingEvents?: EventSummaryItem[];
  timezone: string;
  reviewUrl?: string;
  isImmediate?: boolean;
}) {
  const { orgName, unmappedCount, urgentEvents, upcomingEvents = [], timezone, reviewUrl, isImmediate } = params;

  const subject = urgentEvents.length > 0
    ? `Urgent: ${urgentEvents.length} unmapped event(s) starting soon — ${orgName}`
    : isImmediate
      ? `New unmapped PCO event(s) detected — ${orgName}`
      : `${unmappedCount} upcoming event(s) need door mapping — ${orgName}`;

  const title = urgentEvents.length > 0
    ? `${urgentEvents.length} Urgent Unmapped Event(s)`
    : `${unmappedCount} Unmapped Event(s) Pending Review`;

  const renderRows = (items: EventSummaryItem[]) =>
    items
      .map((ev) => {
        const startStr = formatDateInTz(ev.startsAt, timezone);
        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(ev.title)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:12px;text-transform:uppercase;color:#475569;">${escapeHtml(ev.sourceType)}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(startStr)}</td>
          </tr>
        `;
      })
      .join('');

  const urgentSection = urgentEvents.length > 0
    ? `
      <div style="margin:0 0 16px 0;padding:12px 14px;background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#991b1b;font-size:13px;">
        <strong>Starting within 48 hours:</strong> These events currently have no doors assigned and will not unlock automatically.
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:20px;">
        <tr style="background-color:#f8fafc;">
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Event</th>
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Source</th>
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Starts</th>
        </tr>
        ${renderRows(urgentEvents)}
      </table>
    `
    : '';

  const nonUrgent = upcomingEvents.slice(0, 15);
  const upcomingSection = nonUrgent.length > 0
    ? `
      <p style="margin:0 0 8px 0;font-weight:600;color:#0f172a;">Upcoming Unmapped Events:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;margin-bottom:16px;">
        <tr style="background-color:#f8fafc;">
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Event</th>
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Source</th>
          <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Starts</th>
        </tr>
        ${renderRows(nonUrgent)}
      </table>
    `
    : '';

  const bodyHtml = `
    <p style="margin:0 0 16px 0;">
      <strong>${escapeHtml(orgName)}</strong> has <strong>${unmappedCount}</strong> upcoming Planning Center event(s) in the review queue without assigned doors.
    </p>
    ${urgentSection}
    ${upcomingSection}
    <p style="margin:0;color:#475569;font-size:13px;">
      Open UnFi-PCO to map doors or dismiss non-facility events.
    </p>
  `;

  const allLines = [...urgentEvents, ...nonUrgent].map(
    (ev) => `- ${ev.title} (${ev.sourceType.toUpperCase()}) — ${formatDateInTz(ev.startsAt, timezone)}`
  );

  const textBody = [
    `${orgName}: ${unmappedCount} upcoming unmapped event(s) need door mapping.`,
    '',
    ...allLines,
    reviewUrl ? `\nReview events: ${reviewUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title,
    preheader: `${unmappedCount} unmapped PCO event(s) for ${orgName}`,
    bodyHtml,
    textBody,
    cta: reviewUrl ? { label: 'Review Unmapped Events', url: reviewUrl } : undefined,
    tag: isImmediate ? 'unmapped-events-immediate' : 'unmapped-events-digest',
  };
}

export function buildSelectedEventsShareEmail(params: {
  orgName: string;
  senderEmail?: string;
  note?: string;
  events: EventSummaryItem[];
  timezone: string;
}) {
  const { orgName, senderEmail, note, events, timezone } = params;

  const rowsHtml = events
    .map((ev) => {
      const startStr = formatDateInTz(ev.startsAt, timezone);
      const unlockStr = ev.unlockAt ? formatDateInTz(ev.unlockAt, timezone, 'h:mm a') : '—';
      const lockStr = ev.lockAt ? formatDateInTz(ev.lockAt, timezone, 'h:mm a') : '—';
      const doors = ev.doorLabels && ev.doorLabels.length > 0 ? ev.doorLabels.join(', ') : 'Unmapped';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#0f172a;">${escapeHtml(ev.title)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(startStr)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(unlockStr)} &ndash; ${escapeHtml(lockStr)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">${escapeHtml(doors)}</td>
        </tr>
      `;
    })
    .join('');

  const subject = events.length === 1
    ? `Event Door Schedule: ${events[0].title} — ${orgName}`
    : `${events.length} Scheduled Events — ${orgName}`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">
      ${senderEmail ? `<strong>${escapeHtml(senderEmail)}</strong> shared` : 'Here is'} the door schedule for ${events.length} event(s) at <strong>${escapeHtml(orgName)}</strong>:
    </p>
    ${note ? `<div style="margin:0 0 16px 0;padding:12px 14px;background-color:#f8fafc;border-left:3px solid #2563eb;border-radius:4px;font-size:13px;color:#334155;">${escapeHtml(note).replace(/\n/g, '<br/>')}</div>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:collapse;">
      <tr style="background-color:#f8fafc;">
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Event</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Starts</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Door Window</th>
        <th align="left" style="padding:8px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;">Doors</th>
      </tr>
      ${rowsHtml}
    </table>
  `;

  const textBody = [
    `Event Door Schedule — ${orgName}`,
    note ? `Note: ${note}` : '',
    '',
    ...events.map((ev) => {
      const doors = ev.doorLabels?.length ? ev.doorLabels.join(', ') : 'Unmapped';
      return `- ${ev.title} | ${formatDateInTz(ev.startsAt, timezone)} | Doors: ${doors}`;
    }),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject,
    title: 'Event Door Schedule',
    preheader: `${events.length} event(s) shared from ${orgName}`,
    bodyHtml,
    textBody,
    tag: 'event-schedule-share',
  };
}
