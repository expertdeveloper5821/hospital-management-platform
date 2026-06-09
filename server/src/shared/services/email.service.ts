import { Resend } from 'resend';
import config from '../config/env';
import { AppError } from '../middleware/error-handler';
import { getCorrelationId } from '../config/request-context';

// ─── Template types ───────────────────────────────────────────────────────────
export type EmailTemplate = 'invite' | 'welcome' | 'account-lock' | 'password-reset';

const SUBJECTS: Record<EmailTemplate, string> = {
  'invite':         'Welcome to HMS — Complete Your Hospital Setup',
  'welcome':        'Your HMS Account Has Been Created',
  'account-lock':   'Your HMS Account Has Been Locked',
  'password-reset': 'Reset Your HMS Password',
};

// ─── HTML template functions ──────────────────────────────────────────────────
function inviteHtml(inviteLink: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background-color:#1A73E8;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Hospital Management System</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:18px;font-weight:600;">Your hospital has been approved!</h2>
              <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.6;">
                Congratulations! Your hospital registration has been reviewed and approved. Click the button below to complete your account setup and get started.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:28px 0;">
                <tr>
                  <td style="border-radius:6px;background-color:#1A73E8;">
                    <a href="${inviteLink}"
                       target="_blank"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;letter-spacing:0.2px;">
                      Click Here to Complete Setup
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                &#9201; This link expires in <strong>48 hours</strong>. Please complete your setup before it expires.
              </p>
              <p style="margin:0 0 24px;color:#6b7280;font-size:13px;">
                If the button above doesn't work, copy and paste this URL into your browser:
              </p>
              <p style="margin:0 0 24px;word-break:break-all;">
                <a href="${inviteLink}" style="color:#1A73E8;font-size:12px;">${inviteLink}</a>
              </p>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                If you did not request this, you can safely ignore this email. No account will be created without completing the setup.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; Hospital Management System. All rights reserved.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function welcomeHtml(tempPassword: string, tenantId: string): string {
  return `<p>Your HMS account has been created.</p>
<p>Tenant ID: <strong>${tenantId}</strong></p>
<p>Temporary password: <strong>${tempPassword}</strong></p>
<p>You will be required to change your password on first login.</p>`;
}

function accountLockHtml(): string {
  return `<p>Your HMS account has been locked due to multiple failed login attempts.</p>
<p>It will automatically unlock after 30 minutes.</p>
<p>If this was not you, please contact your administrator.</p>`;
}

function passwordResetHtml(resetLink: string): string {
  return `<p>A password reset was requested for your HMS account.</p>
<p><a href="${resetLink}">Reset Password</a> (link valid for 1 hour)</p>
<p>If you did not request this, please ignore this email.</p>`;
}

function getResendFailureMessage(error: { message: string; name: string }): string {
  const details = `${error.message} ${error.name}`.toLowerCase();

  if (details.includes('api key') || details.includes('unauthorized') || details.includes('403')) {
    return 'Email delivery failed: invalid Resend API key. Check SMTP_PASS in your environment.';
  }

  if (details.includes('verify') || details.includes('domain') || details.includes('from')) {
    return 'Email delivery is blocked by Resend. Use a verified sender domain.';
  }

  if (details.includes('rate') || details.includes('429')) {
    return 'Email rate limit reached. Please wait before sending more emails.';
  }

  return 'Unable to send email. Please check email configuration and retry.';
}

// ─── EmailService ─────────────────────────────────────────────────────────────
class EmailService {
  private client: Resend;

  constructor() {
    this.client = new Resend(config.smtp.pass);
  }

  async verifyConnection(maxAttempts = 4, baseDelayMs = 2_000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Resend has no explicit verify(); a domains list call confirms API key validity.
        const { error } = await this.client.domains.list();
        if (error) throw new Error(error.message);

        console.log(JSON.stringify({
          level: 'info',
          event: 'smtp_verified',
          provider: 'resend-http',
          from: config.smtp.from,
          attempt,
          timestamp: new Date().toISOString(),
        }));
        return;
      } catch (err) {
        const resendError = err as Error & { statusCode?: number };
        const isTransient = !resendError.statusCode || resendError.statusCode >= 500;
        const isLastAttempt = attempt === maxAttempts;

        if (isLastAttempt || !isTransient) {
          console.error(JSON.stringify({
            level: 'error',
            event: 'smtp_verify_failed',
            provider: 'resend-http',
            from: config.smtp.from,
            message: resendError.message,
            statusCode: resendError.statusCode,
            attempt,
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        console.log(JSON.stringify({
          level: 'warn',
          event: 'smtp_verify_retry',
          provider: 'resend-http',
          message: resendError.message,
          attempt,
          nextAttemptInMs: delayMs,
          timestamp: new Date().toISOString(),
        }));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async sendInviteEmail(to: string, inviteLink: string): Promise<void> {
    await this.sendTemplatedEmail('invite', { to, inviteLink });
  }

  async sendWelcomeEmail(to: string, tempPassword: string, tenantId: string): Promise<void> {
    await this.sendTemplatedEmail('welcome', { to, tempPassword, tenantId });
  }

  async sendAccountLockEmail(to: string): Promise<void> {
    await this.sendTemplatedEmail('account-lock', { to });
  }

  async sendPasswordResetEmail(to: string, resetLink: string): Promise<void> {
    await this.sendTemplatedEmail('password-reset', { to, resetLink });
  }

  private async sendTemplatedEmail(
    template: EmailTemplate,
    data: Record<string, string>,
  ): Promise<void> {
    let html: string;
    switch (template) {
      case 'invite':         html = inviteHtml(data.inviteLink!);         break;
      case 'welcome':        html = welcomeHtml(data.tempPassword!, data.tenantId!); break;
      case 'account-lock':   html = accountLockHtml();                    break;
      case 'password-reset': html = passwordResetHtml(data.resetLink!);   break;
    }

    const { data: result, error } = await this.client.emails.send({
      from:    config.smtp.from,
      to:      data.to,
      subject: SUBJECTS[template],
      html,
    });

    if (error) {
      const resendError = error as Error & { statusCode?: number };

      console.error(JSON.stringify({
        level:         'error',
        event:         'smtp_failure',
        correlationId: getCorrelationId(),
        provider:      'resend-http',
        template,
        to:            data.to,
        from:          config.smtp.from,
        message:       resendError.message,
        statusCode:    resendError.statusCode,
        timestamp:     new Date().toISOString(),
      }));

      throw new AppError(getResendFailureMessage(resendError), 500);
    }

    console.log(JSON.stringify({
      level:         'info',
      event:         'smtp_sent',
      correlationId: getCorrelationId(),
      provider:      'resend-http',
      template,
      to:            data.to,
      messageId:     result?.id,
      timestamp:     new Date().toISOString(),
    }));
  }
}

export const emailService = new EmailService();
