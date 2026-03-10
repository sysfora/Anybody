import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: NextRequest) {
  try {
    const { email, invitationLink } = await request.json();

    if (!email || !invitationLink) {
      return NextResponse.json(
        { error: 'Email and invitation link are required' },
        { status: 400 }
      );
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpSecure = process.env.SMTP_SECURE === 'true';
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFromEmail = process.env.SMTP_FROM_EMAIL || smtpUser;
    const smtpFromName = process.env.SMTP_FROM_NAME || 'Anybody';

    if (!smtpHost || !smtpUser || !smtpPass) {
      console.error('SMTP configuration is incomplete');
      return NextResponse.json(
        { error: 'Email service is not configured' },
        { status: 500 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const appName = smtpFromName || 'Anybody';
    
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .btn {
                display: inline-block;
                vertical-align: top;
                border: 0;
                color: #fff !important;
                background: #16161a !important;
                text-decoration: none !important;
                line-height: 40px;
                width: auto;
                min-width: 150px;
                text-align: center;
                padding: 0 20px;
                margin: 5px 0;
                font-family: Source Sans Pro, sans-serif, emoji;
                font-size: 14px;
                font-weight: bold;
                border-radius: 6px;
                box-sizing: border-box;
            }
          </style>
        </head>
        <body>
          <p>Hello,</p>

          <p>You have been invited to join a team. Click the button below to accept the invitation:</p>

          <p>
            <a class="btn" href="${invitationLink}" target="_blank" rel="noopener">Accept Invitation</a>
          </p>

          <p>Or copy and paste this link into your browser:</p>
          <p>${invitationLink}</p>

          <p>This invitation does not expire.</p>
          <p>If you didn't expect this invitation, you can safely ignore this email.</p>

          <p>
            Thanks,<br/>
            ${appName} team
          </p>
        </body>
      </html>
    `;

    const mailOptions = {
      from: `"${smtpFromName}" <${smtpFromEmail}>`,
      to: email,
      subject: `You're Invited to Join a Team`,
      html: emailHtml,
      text: `You're invited to join a team!\n\nClick this link to accept: ${invitationLink}\n\nThis invitation does not expire.`,
    };

    await transporter.sendMail(mailOptions);

    return NextResponse.json({ success: true, message: 'Invitation email sent' });
  } catch (error) {
    console.error('Error sending invitation:', error);
    return NextResponse.json(
      { error: 'Failed to send invitation email' },
      { status: 500 }
    );
  }
}

