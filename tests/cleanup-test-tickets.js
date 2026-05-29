/**
 * Briše test tickete iz Zendeska na temelju requester email domena.
 * Pokretanje: node tests/cleanup-test-tickets.js
 */
const axios = require("axios");
const env = require("../config/env");

const ZENDESK_SUBDOMAIN = env.ZENDESK_SUBDOMAIN;
const ZENDESK_API_TOKEN = env.ZENDESK_API_TOKEN;
const ZENDESK_API_USER = env.ZENDESK_API_USER;

async function findTestTickets() {
  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search.json?query=type:ticket requester_email:*@libar.local`;
  const resp = await axios.get(url, {
    auth: { username: `${ZENDESK_API_USER}/token`, password: ZENDESK_API_TOKEN }
  });
  return resp.data.results || [];
}

async function deleteTicket(ticketId) {
  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}.json`;
  await axios.delete(url, {
    auth: { username: `${ZENDESK_API_USER}/token`, password: ZENDESK_API_TOKEN }
  });
}

async function main() {
  const tickets = await findTestTickets();
  console.log(`Found ${tickets.length} test tickets to delete.`);
  let deleted = 0;
  for (const t of tickets) {
    try {
      await deleteTicket(t.id);
      deleted++;
      console.log(`Deleted #${t.id} (${t.subject})`);
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`Failed to delete #${t.id}: ${err.message}`);
    }
  }
  console.log(`Done. Deleted ${deleted}/${tickets.length} tickets.`);
}

main().catch(e => { console.error(e); process.exit(1); });
