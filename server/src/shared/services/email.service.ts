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

function getSmtpFailureMessage(error: {
  message: string;
  response?: string;
}): string {
  const details = `${error.message} ${error.response ?? ''}`.toLowerCase();

  if (details.includes('from') && details.includes('invalid')) {
    return 'Email delivery is misconfigured. SMTP_FROM must be a valid sender email address.';
  }

  if (details.includes('enotfound') || details.includes('getaddrinfo')) {
    return 'Unable to resolve the SMTP host. Check your DNS or internet connection and retry.';
  }

  if (details.includes('verify a domain') || details.includes('resend.dev')) {
    return 'Email delivery is blocked by Resend. Use a verified sender domain, or test only with your own Resend account address.';
  }

  if (details.includes('auth') || details.includes('invalid login')) {
    return 'Unable to authenticate with the SMTP provider. Recheck SMTP_USER and SMTP_PASS.';
  }

  return 'Unable to send email. Please check SMTP configuration and retry.';
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
      requireTLS: config.smtp.port === 587,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass, // SECURITY-03: never logged
      },
    });
  }

  async verifyConnection(maxAttempts = 4, baseDelayMs = 2_000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transporter.verify();
        console.log(JSON.stringify({
          level: 'info',
          event: 'smtp_verified',
          host: config.smtp.host,
          port: config.smtp.port,
          user: config.smtp.user,
          from: config.smtp.from,
          attempt,
          timestamp: new Date().toISOString(),
        }));
        return;
      } catch (err) {
        const smtpError = err as Error & {
          code?: string;
          command?: string;
          response?: string;
          responseCode?: number;
        };

        const isTransient =
          smtpError.code === 'EDNS' ||
          smtpError.code === 'ECONNREFUSED' ||
          smtpError.code === 'ETIMEDOUT' ||
          smtpError.code === 'ENOTFOUND';

        const isLastAttempt = attempt === maxAttempts;

        if (isLastAttempt || !isTransient) {
          console.error(JSON.stringify({
            level: 'error',
            event: 'smtp_verify_failed',
            host: config.smtp.host,
            port: config.smtp.port,
            user: config.smtp.user,
            from: config.smtp.from,
            message: smtpError.message,
            code: smtpError.code,
            command: smtpError.command,
            response: smtpError.response,
            responseCode: smtpError.responseCode,
            stack: smtpError.stack,
            attempt,
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        console.log(JSON.stringify({
          level: 'warn',
          event: 'smtp_verify_retry',
          host: config.smtp.host,
          port: config.smtp.port,
          code: smtpError.code,
          message: smtpError.message,
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
      const info = await this.transporter.sendMail({
        from:    config.smtp.from,
        to:      data.to,
        subject: SUBJECTS[template],
        html,
      });

      console.log(JSON.stringify({
        level:         'info',
        event:         'smtp_sent',
        correlationId: getCorrelationId(),
        template,
        to:            data.to,
        messageId:     info.messageId,
        accepted:      info.accepted,
        rejected:      info.rejected,
        pending:       info.pending,
        response:      info.response,
        timestamp:     new Date().toISOString(),
      }));
    } catch (err) {
      const smtpError = err as Error & {
        code?: string;
        command?: string;
        response?: string;
        responseCode?: number;
      };

      // EMAIL-04: Log error without exposing SMTP credentials (SECURITY-03)
      console.error(JSON.stringify({
        level:         'error',
        event:         'smtp_failure',
        correlationId: getCorrelationId(),
        template,
        to:            data.to,
        host:          config.smtp.host,
        port:          config.smtp.port,
        user:          config.smtp.user,
        from:          config.smtp.from,
        message:       smtpError.message,
        code:          smtpError.code,
        command:       smtpError.command,
        response:      smtpError.response,
        responseCode:  smtpError.responseCode,
        stack:         smtpError.stack,
        timestamp:     new Date().toISOString(),
      }));
      
      throw new AppError(
        getSmtpFailureMessage(smtpError),
        500,
      );
    }
  }
}

export const emailService = new EmailService();
