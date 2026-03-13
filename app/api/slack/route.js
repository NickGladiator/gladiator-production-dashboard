import { NextResponse } from 'next/server';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNEL_ID = process.env.SLACK_YARD_SIGNS_CHANNEL_ID;

function getTechMap() {
  try {
    return JSON.parse(process.env.TECH_SLACK_MAP || '{}');
  } catch {
    return {};
  }
}

export async function GET(request) {
  try {
    const TECH_SLACK_MAP = getTechMap();
    const SLACK_TO_TECH = Object.fromEntries(
      Object.entries(TECH_SLACK_MAP).map(([hcp, slack]) => [slack.toLowerCase(), hcp])
    );

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 });
    }

    const oldest = Math.floor(new Date(startDate).getTime() / 1000).toString();
    const latest = Math.floor(new Date(endDate + 'T23:59:59').getTime() / 1000).toString();

    const usersRes = await fetch('https://slack.com/api/users.list', {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const usersData = await usersRes.json();
    if (!usersData.ok) throw new Error(`Slack users.list error: ${usersData.error}`);

    const userIdToTech = {};
    for (const member of usersData.members) {
      const username = member.name?.toLowerCase();
      const displayName = member.profile?.display_name?.toLowerCase();
      const realName = member.profile?.real_name?.toLowerCase();

      for (const [slackUsername, techName] of Object.entries(SLACK_TO_TECH)) {
        if (username === slackUsername || displayName === slackUsername || realName === slackUsername) {
          userIdToTech[member.id] = techName;
          break;
        }
      }
    }

    let allMessages = [];
    let cursor = undefined;

    while (true) {
      const params = new URLSearchParams({ channel: CHANNEL_ID, oldest, latest, limit: '200' });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(`Slack error: ${data.error}`);

      allMessages = allMessages.concat(data.messages || []);
      if (!data.response_metadata?.next_cursor) break;
      cursor = data.response_metadata.next_cursor;
    }

    const yardSigns = {};
    for (const msg of allMessages) {
      const hasPhoto = (msg.files && msg.files.some(f => f.mimetype?.startsWith('image/'))) ||
                       (msg.attachments && msg.attachments.some(a => a.image_url));
      if (!hasPhoto) continue;

      const techName = userIdToTech[msg.user];
      if (!techName) continue;

      yardSigns[techName] = (yardSigns[techName] || 0) + 1;
    }

    return NextResponse.json({ success: true, data: yardSigns });
  } catch (err) {
    console.error('Slack API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}