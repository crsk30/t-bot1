/**
 * email-scheduler.js
 * ==================
 * Schedules a daily email at 15:28 (3:28 PM IST) containing
 * the AutoTrader Thought Journal for the day.
 *
 * Uses:
 *  - node-cron   (already a dependency)
 *  - nodemailer  (SMTP email)
 *  - axios       (to fetch thoughts from Python engine)
 */

const cron = require("node-cron");
const nodemailer = require("nodemailer");
const axios = require("axios");

// ─── Config from environment ───────────────────────────────────────────────────
const PYTHON_BASE     = process.env.PYTHON_API_URL   || "http://localhost:8000";
const SMTP_HOST       = process.env.SMTP_HOST        || "smtp.gmail.com";
const SMTP_PORT       = parseInt(process.env.SMTP_PORT || "465", 10);
const SMTP_SECURE     = process.env.SMTP_SECURE      !== "false"; // default true
const SMTP_USER       = process.env.SMTP_USER        || "";
const SMTP_PASS       = process.env.SMTP_PASS        || "";
const EMAIL_FROM      = process.env.EMAIL_FROM       || SMTP_USER;
const EMAIL_TO        = process.env.EMAIL_TO         || "";
// Schedule: "28 15 * * 1-5"  → 3:28 PM on weekdays (Mon–Fri)
// Change to  "28 15 * * *"   → every day including weekends
const CRON_SCHEDULE   = process.env.JOURNAL_CRON    || "28 15 * * 1-5";

// ─── Nodemailer transporter ───────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

// ─── Fetch thoughts from Python engine ────────────────────────────────────────
async function fetchThoughts() {
  try {
    const res = await axios.get(`${PYTHON_BASE}/autotrader/thoughts?limit=500`, {
      timeout: 15000,
    });
    return res.data?.thoughts || [];
  } catch (err) {
    console.error("[EmailScheduler] Failed to fetch thoughts:", err.message);
    return [];
  }
}

// ─── Filter to today's thoughts only ─────────────────────────────────────────
function filterToday(thoughts) {
  const todayStr = new Date().toDateString();
  return thoughts.filter((t) => {
    try {
      return new Date(t.timestamp).toDateString() === todayStr;
    } catch {
      return true; // include if timestamp is unparseable
    }
  });
}

// ─── Badge colour mapping (inline CSS for email clients) ─────────────────────
function getBadgeStyle(action = "") {
  if (action.includes("BUY"))
    return "background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;";
  if (action.includes("SELL") || action.includes("EXIT"))
    return "background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;";
  if (action.includes("START") || action.includes("STOP"))
    return "background:#2563eb;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;";
  return "background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;";
}

// ─── Build HTML email body ────────────────────────────────────────────────────
function buildHtmlEmail(thoughts, dateStr) {
  const totalThoughts = thoughts.length;
  const decidedCount  = thoughts.filter((t) => t.decided).length;
  const buyCount      = thoughts.filter((t) => t.action?.includes("BUY") && t.decided).length;
  const sellCount     = thoughts.filter((t) => (t.action?.includes("SELL") || t.action?.includes("EXIT")) && t.decided).length;

  const rows = thoughts.length
    ? thoughts
        .map(
          (t) => `
      <tr style="border-bottom:1px solid #374151;">
        <td style="padding:10px 12px;color:#9ca3af;font-size:12px;font-family:monospace;white-space:nowrap;">
          ${new Date(t.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </td>
        <td style="padding:10px 12px;text-align:center;font-size:16px;">
          ${t.decided ? "✅" : "❌"}
        </td>
        <td style="padding:10px 12px;">
          <span style="${getBadgeStyle(t.action)}">
            ${(t.action || "").replace("EVALUATE_", "EVAL ")}
          </span>
        </td>
        <td style="padding:10px 12px;font-weight:700;color:#f9fafb;">
          ${(t.symbol || "").replace(".NS", "")}
        </td>
        <td style="padding:10px 12px;color:#d1d5db;font-size:13px;line-height:1.5;">
          ${t.reasoning || "—"}
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" style="padding:40px;text-align:center;color:#6b7280;">
        No thoughts recorded for today.
      </td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>AutoTrader Thought Journal – ${dateStr}</title>
</head>
<body style="margin:0;padding:0;background:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

  <!-- WRAPPER -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#111827;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="800" cellpadding="0" cellspacing="0" style="max-width:800px;width:100%;">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a5f 0%,#0f172a 100%);
                        border-radius:16px 16px 0 0;padding:32px 36px;">
              <div style="font-size:28px;font-weight:800;color:#f9fafb;letter-spacing:-0.5px;">
                🧠 AutoTrader Thought Journal
              </div>
              <div style="font-size:14px;color:#94a3b8;margin-top:6px;">${dateStr}</div>
            </td>
          </tr>

          <!-- SUMMARY CARDS -->
          <tr>
            <td style="background:#1f2937;padding:24px 36px;border-bottom:1px solid #374151;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 8px;">
                    <div style="background:#0f172a;border:1px solid #374151;border-radius:10px;padding:16px 24px;">
                      <div style="font-size:28px;font-weight:800;color:#f9fafb;">${totalThoughts}</div>
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-top:4px;">Total Thoughts</div>
                    </div>
                  </td>
                  <td align="center" style="padding:0 8px;">
                    <div style="background:#0f172a;border:1px solid #374151;border-radius:10px;padding:16px 24px;">
                      <div style="font-size:28px;font-weight:800;color:#22c55e;">${decidedCount}</div>
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-top:4px;">Decided ✅</div>
                    </div>
                  </td>
                  <td align="center" style="padding:0 8px;">
                    <div style="background:#0f172a;border:1px solid #374151;border-radius:10px;padding:16px 24px;">
                      <div style="font-size:28px;font-weight:800;color:#16a34a;">${buyCount}</div>
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-top:4px;">BUY Signals</div>
                    </div>
                  </td>
                  <td align="center" style="padding:0 8px;">
                    <div style="background:#0f172a;border:1px solid #374151;border-radius:10px;padding:16px 24px;">
                      <div style="font-size:28px;font-weight:800;color:#dc2626;">${sellCount}</div>
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-top:4px;">SELL / EXIT</div>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- TABLE HEADER -->
          <tr>
            <td style="background:#1f2937;padding:0 36px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border-collapse:collapse;">
                <thead>
                  <tr style="background:#0f172a;">
                    <th style="padding:12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;white-space:nowrap;">Time</th>
                    <th style="padding:12px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;width:50px;">✓</th>
                    <th style="padding:12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Action</th>
                    <th style="padding:12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Symbol</th>
                    <th style="padding:12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#0f172a;border-radius:0 0 16px 16px;
                        padding:20px 36px;text-align:center;">
              <div style="font-size:12px;color:#4b5563;">
                TradeMind AI · AutoTrader Daily Report · Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────
function buildTextEmail(thoughts, dateStr) {
  const lines = [`AutoTrader Thought Journal – ${dateStr}`, "=".repeat(60), ""];
  if (!thoughts.length) {
    lines.push("No thoughts recorded for today.");
  } else {
    thoughts.forEach((t) => {
      const time    = new Date(t.timestamp).toLocaleTimeString("en-IN");
      const decided = t.decided ? "[✓]" : "[✗]";
      const symbol  = (t.symbol || "").replace(".NS", "");
      lines.push(`${time}  ${decided}  ${t.action}  ${symbol}`);
      lines.push(`  → ${t.reasoning}`);
      lines.push("");
    });
  }
  lines.push("-".repeat(60));
  lines.push(`Generated at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`);
  return lines.join("\n");
}

// ─── Main send function ────────────────────────────────────────────────────────
async function sendJournalEmail() {
  if (!EMAIL_TO) {
    console.warn("[EmailScheduler] EMAIL_TO is not set. Skipping journal email.");
    return;
  }
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn("[EmailScheduler] SMTP_USER / SMTP_PASS not configured. Skipping.");
    return;
  }

  console.log("[EmailScheduler] Fetching today's thoughts…");
  const allThoughts    = await fetchThoughts();
  const todayThoughts  = filterToday(allThoughts);
  const dateStr        = new Date().toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const html = buildHtmlEmail(todayThoughts, dateStr);
  const text = buildTextEmail(todayThoughts, dateStr);

  const transporter = createTransporter();

  try {
    const info = await transporter.sendMail({
      from:    `"TradeMind AI" <${EMAIL_FROM}>`,
      to:      EMAIL_TO,
      subject: `🧠 Trader Journal – ${dateStr} (${todayThoughts.length} thoughts)`,
      text,
      html,
    });
    console.log(`[EmailScheduler] Journal email sent! MessageId: ${info.messageId}`);
  } catch (err) {
    console.error("[EmailScheduler] Failed to send email:", err.message);
  }
}

// ─── Register the cron job ────────────────────────────────────────────────────
function startScheduler() {
  if (!cron.validate(CRON_SCHEDULE)) {
    console.error(`[EmailScheduler] Invalid cron schedule: "${CRON_SCHEDULE}". Scheduler not started.`);
    return;
  }

  console.log(`[EmailScheduler] Journal email scheduled → "${CRON_SCHEDULE}" (3:28 PM weekdays IST)`);

  cron.schedule(
    CRON_SCHEDULE,
    () => {
      console.log("[EmailScheduler] Triggering daily journal email…");
      sendJournalEmail().catch((err) =>
        console.error("[EmailScheduler] Unhandled error:", err.message)
      );
    },
    {
      timezone: "Asia/Kolkata", // IST – ensures 15:28 fires at the right time
    }
  );
}

module.exports = { startScheduler, sendJournalEmail };
