import nodemailer, { Transporter } from 'nodemailer';
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
  return `<p>You have been invited to set up your hospital on HMS.</p>
<p><a href="${inviteLink}">Complete Setup</a> (link valid for 48 hours)</p>
<p>If you did not request this, please ignore this email.</p>`;
}

function welcomeHtml(tempPassword: string): string {
  return `<p>Your HMS account has been created.</p>
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

// ─── EmailService ─────────────────────────────────────────────────────────────
class EmailService {
  private transporter: Transporter;

  constructor() {
    // EMAIL-02: SMTP credentials from config — NEVER hardcoded
    this.transporter = nodemailer.createTransport({
      host:   config.smtp.host,
      port:   config.smtp.port,
      secure: config.smtp.port === 465,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass, // SECURITY-03: never logged
      },
    });
  }

  async sendInviteEmail(to: string, inviteLink: string): Promise<void> {
    await this.sendTemplatedEmail('invite', { to, inviteLink });
  }

  async sendWelcomeEmail(to: string, tempPassword: string): Promise<void> {
    await this.sendTemplatedEmail('welcome', { to, tempPassword });
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
      case 'welcome':        html = welcomeHtml(data.tempPassword!);      break;
      case 'account-lock':   html = accountLockHtml();                    break;
      case 'password-reset': html = passwordResetHtml(data.resetLink!);   break;
    }

    try {
      await this.transporter.sendMail({
        from:    config.smtp.from,
        to:      data.to,
        subject: SUBJECTS[template],
        html,
      });
    } catch (err) {
      // EMAIL-04: Log error without exposing SMTP credentials (SECURITY-03)
      console.error(JSON.stringify({
        level:         'error',
        event:         'smtp_failure',
        correlationId: getCorrelationId(),
        template,
        to:            data.to,
        message:       (err as Error).message,
        timestamp:     new Date().toISOString(),
      }));
      throw new AppError(
        'Unable to send email. Please check SMTP configuration and retry.',
        500,
      );
    }
  }
}

export const emailService = new EmailService();
