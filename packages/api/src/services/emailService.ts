import { Resend } from "resend";

// Ported verbatim from the reference's emailService.ts. Sends the workspace
// invite email via Resend. No data-layer change here (email isn't stored in
// Postgres/Redis) — the only difference is the default FROM address. Never
// throws; invite creation must not be blocked by an email send failure. When
// RESEND_API_KEY is unset (the local default) the send is skipped gracefully.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.RESEND_FROM ?? "ContextMaster <noreply@localhost>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export interface InviteEmailParams {
  to: string;
  inviterName: string;
  workspaceName: string;
  inviteLink: string;
  role: string;
}

export async function sendInviteEmail(
  params: InviteEmailParams
): Promise<{ ok: boolean; reason?: string }> {
  if (!resend) {
    console.warn(
      "[email] RESEND_API_KEY not set — skipping invite email to",
      params.to
    );
    return { ok: false, reason: "RESEND_API_KEY not configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: params.to,
      subject: `${params.inviterName} invited you to "${params.workspaceName}" on ContextMaster`,
      html: renderInviteEmail(params),
    });
    if (error) {
      console.error("[email] resend send error:", error);
      return { ok: false, reason: error.message ?? "send error" };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[email] send failed:", err?.message ?? err);
    return { ok: false, reason: err?.message ?? "send failed" };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInviteEmail(params: InviteEmailParams): string {
  const inviter = escapeHtml(params.inviterName);
  const workspace = escapeHtml(params.workspaceName);
  const role = escapeHtml(params.role);
  const link = escapeHtml(params.inviteLink);

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#fbf8f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#3a3320;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf8f1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid rgba(67,55,39,0.10);overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="display:inline-block;background:linear-gradient(135deg,#3a3320,#5a4d36);color:#fffaf0;font-weight:700;font-size:13px;letter-spacing:0.08em;padding:6px 10px;border-radius:8px;">
                  ContextMaster
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#5a4d36;">Hi there,</p>
                <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:600;color:#2a2415;">
                  ${inviter} invited you to join <span style="color:#8a5e1f;">${workspace}</span>
                </h1>
                <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#5a4d36;">
                  You've been invited as <strong style="color:#3a3320;">${role}</strong>.
                </p>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.6;color:#5a4d36;">
                  ContextMaster gives your AI sessions persistent memory — decisions,
                  findings, and progress that carry across every conversation.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 24px 32px;">
                <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#cf7d4a,#d6a24a);color:#fffaf0;font-weight:600;font-size:14px;text-decoration:none;padding:12px 26px;border-radius:8px;">
                  Accept Invite
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <p style="margin:0 0 6px 0;font-size:12px;color:#8a8473;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0;font-size:12px;color:#5a4d36;word-break:break-all;">
                  <a href="${link}" style="color:#5a4d36;text-decoration:underline;">${link}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;border-top:1px solid rgba(67,55,39,0.08);">
                <p style="margin:16px 0 8px 0;font-size:12px;line-height:1.6;color:#8a8473;">
                  This invite expires in 7 days.
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#8a8473;">
                  If you didn't expect this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;color:#8a8473;">
            © ContextMaster
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
