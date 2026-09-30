import axios from 'axios';

export interface SlackNotificationPayload {
  webhookUrl: string;
  orgName: string;
  unmappedCount: number;
  urgentEvents: Array<{
    title: string;
    startsAt: string;
    sourceType: string;
  }>;
  reviewUrl?: string;
}

/**
 * Sends a structured Slack notification for unmapped upcoming PCO events.
 */
export async function sendSlackUnmappedEventAlert(payload: SlackNotificationPayload): Promise<boolean> {
  const { webhookUrl, orgName, unmappedCount, urgentEvents } = payload;
  if (!webhookUrl) return false;

  const titleText = urgentEvents.length > 0
    ? `🚨 *${orgName}: ${urgentEvents.length} Urgent Unmapped Event(s) Starting Soon!*`
    : `⚠️ *${orgName}: ${unmappedCount} Upcoming Event(s) Need Door Schedule Mapping*`;

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: titleText,
      },
    },
  ];

  if (urgentEvents.length > 0) {
    const eventLines = urgentEvents.map((ev) =>
      `• *${ev.title}* (${ev.sourceType.toUpperCase()}) — ${ev.startsAt}`
    ).join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Urgent Events (Starting < 48 hours):*\n${eventLines}`,
      },
    });
  }

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `Total unmapped upcoming events in review queue: *${unmappedCount}*\nPlease open UnFi-PCO to review and map doors or mark events as non-facility.`,
    },
  });

  try {
    await axios.post(webhookUrl, { blocks });
    return true;
  } catch (err) {
    console.error(`Failed to send Slack webhook for org ${orgName}:`, err);
    return false;
  }
}
