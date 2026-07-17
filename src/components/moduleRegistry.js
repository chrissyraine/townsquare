// Shared module registry — sidebar order + presentation for the brokered
// per-product tabs (Herald, Drawbridge, Belltower, Hearth, Courier) and the
// external launch tiles (Paige, Forge). Extracted from Dashboard.jsx so
// DashboardHome's "Your Tools" widget doesn't duplicate this list.
export const MODULES = [
  { key: 'herald', label: 'The Herald', icon: '/theherald.svg', pitch: 'Broadcast announcements and live hours straight onto your website — no logins to your site builder.' },
  { key: 'drawbridge', label: 'Drawbridge', icon: '/drawbridge.svg', pitch: 'Run your live menu from your phone: mark items sold out and post daily specials in seconds.' },
  { key: 'belltower', label: 'Belltower', emoji: '🔔', pitch: 'Take bookings 24/7 — appointments, tables, or whole events — synced to your calendar.' },
  { key: 'hearth', label: 'The Hearth', emoji: '🔥', pitch: 'Grow your Google reviews and catch unhappy customers privately, before they post.' },
  { key: 'courier', label: 'Paige', emoji: '✉️', pitch: 'Capture every message from your website contact form — recorded in your dashboard and emailed to you instantly, with an auto-reply to the customer. Never lose a lead.' },
  { key: 'paige', label: 'The Paige', emoji: '📞', external: true, url: 'https://getthepaige.app' },
  { key: 'forge', label: 'The Forge', emoji: '⚒️', external: true, url: 'https://gettheforge.app' },
];
