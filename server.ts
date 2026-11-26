import dotenv from 'dotenv';
import express from 'express';
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, brand: 'SIRIMAGGA', timestamp: new Date().toISOString() });
  });

  // Payment Gateway Configuration Status (never exposes secrets)
  app.get('/api/payments/config', (_req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    const configured = Boolean(keyId && keySecret);

    res.json({
      provider: 'Razorpay',
      configured,
      mode: configured ? 'configured' : 'test_placeholder',
      keyId: configured ? keyId : null,
      currency: 'INR',
      supportedMethods: ['UPI', 'Card', 'NetBanking', 'COD'],
    });
  });

  // Create Payment Order (Real Razorpay when configured, explicit Test Mode placeholder otherwise)
  app.post('/api/payments/create-order', async (req, res) => {
    try {
      const amountInRupees = Number(req.body?.amount || 0);
      const receipt = String(req.body?.receipt || `SIRI-${Date.now()}`).slice(0, 40);

      if (!Number.isFinite(amountInRupees) || amountInRupees <= 0) {
        return res.status(400).json({ error: 'Invalid order amount' });
      }

      const amountInPaise = Math.round(amountInRupees * 100);
      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      if (keyId && keySecret) {
        const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amountInPaise,
            currency: 'INR',
            receipt,
          }),
        });

        if (!rzpRes.ok) {
          const errText = await rzpRes.text();
          return res.status(502).json({ error: `Payment provider error: ${errText}` });
        }

        const rzpOrder = (await rzpRes.json()) as { id: string; amount: number; currency: string };
        return res.json({
          testMode: false,
          providerOrderId: rzpOrder.id,
          amountInPaise: rzpOrder.amount,
          currency: rzpOrder.currency,
          keyId,
        });
      }

      return res.json({
        testMode: true,
        providerOrderId: `TEST_RZP_${receipt}`,
        amountInPaise,
        currency: 'INR',
        message: 'Running in Test Mode placeholder until Razorpay credentials are configured.',
      });
    } catch (error) {
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Unable to initialize payment order',
      });
    }
  });

  // Order Status Email Notification Configuration & Dispatch
  app.get('/api/notifications/config', (_req, res) => {
    const smtpConfigured = Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    );
    res.json({
      smtpConfigured,
      cloudFunctionsPath: '/functions/src/index.ts',
      mode: smtpConfigured ? 'smtp_active' : 'preview_and_cloud_function_ready',
    });
  });

  app.post('/api/notifications/order-status', async (req, res) => {
    try {
      const {
        orderNumber,
        customerName,
        recipientEmail,
        status,
        totalAmount,
        courierName,
        trackingNumber,
      } = req.body as {
        orderNumber?: string;
        customerName?: string;
        recipientEmail?: string;
        status?: string;
        totalAmount?: number;
        courierName?: string;
        trackingNumber?: string;
      };

      if (!orderNumber || !recipientEmail || !status) {
        return res.status(400).json({ error: 'Missing orderNumber, recipientEmail, or status' });
      }

      const statusMessages: Record<string, { headline: string; body: string }> = {
        'Order Placed': {
          headline: 'We have received your SIRIMAGGA order',
          body: 'Our team in Bagalkot District is confirming availability before preparing your saree for quality inspection.',
        },
        Confirmed: {
          headline: 'Your order is confirmed',
          body: 'Availability is confirmed and your saree is entering our quality inspection queue.',
        },
        'Quality Inspection': {
          headline: 'Quality inspection in progress',
          body: 'Your saree is being reviewed for weave clarity, border finish, and drape.',
        },
        'Packaging in Progress': {
          headline: 'Packaging in SIRIMAGGA signature care',
          body: 'Your saree has passed inspection and is being tagged and folded in protective packaging.',
        },
        'Ready to Dispatch': {
          headline: 'Your order is ready to dispatch',
          body: 'Your parcel is packed and awaiting courier handover.',
        },
        Shipped: {
          headline: 'Your SIRIMAGGA order has shipped',
          body: 'Your saree is on its way across India. Follow live progress on our Track Order page.',
        },
        Delivered: {
          headline: 'Your SIRIMAGGA order has been delivered',
          body: 'We hope you cherish your Karnataka weave. Thank you for choosing SIRIMAGGA.',
        },
        'Unavailable - Action Needed': {
          headline: 'Availability update on your order',
          body: 'Our customer care team will contact you shortly regarding an item in your order to arrange an alternative or refund.',
        },
        Cancelled: {
          headline: 'Your SIRIMAGGA order has been cancelled',
          body: 'This order has been cancelled. Any applicable refund will be processed to your original payment method.',
        },
      };

      const template = statusMessages[status] || {
        headline: `Order status updated to ${status}`,
        body: `Your SIRIMAGGA order ${orderNumber} is now: ${status}.`,
      };

      const appBaseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const trackUrl = `${appBaseUrl}/track-order?orderId=${encodeURIComponent(
        orderNumber
      )}&email=${encodeURIComponent(recipientEmail)}`;

      const subject = `SIRIMAGGA Order ${orderNumber}: ${status}`;
      const previewText = `${template.headline} — ${template.body}${
        trackingNumber ? ` Tracking: ${courierName || 'Courier'} (${trackingNumber})` : ''
      }`;

      const host = process.env.SMTP_HOST || '';
      const port = Number(process.env.SMTP_PORT || 587);
      const user = process.env.SMTP_USER || '';
      const pass = process.env.SMTP_PASS || '';
      const from = process.env.FROM_EMAIL || 'SIRIMAGGA <orders@sirimagga.example>';

      if (host && user && pass) {
        const transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });

        const formattedTotal = new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          maximumFractionDigits: 0,
        }).format(Number(totalAmount || 0));

        const html = `
          <div style="background:#F5EFE4;padding:24px;font-family:Georgia,serif;color:#332821;">
            <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid #B18A4A;border-radius:8px;overflow:hidden;">
              <div style="background:#651D2D;color:#F5EFE4;padding:18px 24px;text-align:center;">
                <strong style="font-size:20px;letter-spacing:2px;">SIRIMAGGA</strong>
                <div style="font-size:12px;margin-top:4px;">Bagalkot District · Karnataka</div>
              </div>
              <div style="padding:24px;font-family:Arial,sans-serif;line-height:1.6;">
                <p>Namaskara ${customerName || 'Valued Guest'},</p>
                <h2 style="font-family:Georgia,serif;color:#651D2D;">${template.headline}</h2>
                <p>${template.body}</p>
                <p><strong>Order ID:</strong> ${orderNumber}<br/><strong>Status:</strong> ${status}<br/><strong>Total:</strong> ${formattedTotal}</p>
                ${
                  courierName || trackingNumber
                    ? `<p style="padding:12px;background:#FAF6EE;border:1px solid #B18A4A;border-radius:6px;">
                         <strong>Courier:</strong> ${courierName || 'Partner Courier'}<br/>
                         ${trackingNumber ? `<strong>Tracking Number:</strong> ${trackingNumber}` : ''}
                       </p>`
                    : ''
                }
                <p><a href="${trackUrl}" style="display:inline-block;background:#651D2D;color:#F5EFE4;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;">Track Order Live</a></p>
              </div>
            </div>
          </div>
        `;

        const info = await transporter.sendMail({
          from,
          to: recipientEmail,
          subject,
          text: `${template.headline}\n\n${template.body}\n\nOrder ID: ${orderNumber}\nStatus: ${status}\nTrack: ${trackUrl}`,
          html,
        });

        return res.json({
          deliveryState: 'sent_smtp',
          subject,
          previewText,
          providerMessage: `Sent via SMTP (${info.messageId})`,
        });
      }

      return res.json({
        deliveryState: 'queued_cloud_function',
        subject,
        previewText,
        providerMessage:
          'Logged for Cloud Functions / SMTP dispatch (configure SMTP_HOST/USER/PASS or deploy /functions).',
      });
    } catch (error) {
      return res.status(500).json({
        deliveryState: 'failed',
        error: error instanceof Error ? error.message : 'Notification dispatch failed',
      });
    }
  });

  // Dynamic SEO Sitemap & Robots.txt
  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const staticPaths = [
      '/',
      '/shop',
      '/collection/ilkal-sarees',
      '/collection/banahatti-cotton-sarees',
      '/collection/traditional-cotton-sarees',
      '/collection/silk-sarees',
      '/collection/festive-sarees',
      '/collection/daily-wear-sarees',
      '/about',
      '/track-order',
      '/contact',
      '/policies/shipping',
      '/policies/returns',
      '/policies/privacy',
      '/policies/terms',
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPaths
  .map(
    (urlPath) => `  <url>
    <loc>${baseUrl}${urlPath}</loc>
    <changefreq>weekly</changefreq>
  </url>`
  )
  .join('\n')}
</urlset>`;

    res.type('application/xml').send(xml);
  });

  app.get('/robots.txt', (req, res) => {
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${baseUrl}/sitemap.xml\n`);
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SIRIMAGGA server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
