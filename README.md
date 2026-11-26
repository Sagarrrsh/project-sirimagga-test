<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/81d0b765-4edd-4474-b870-a982e29713d4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Deploy to GitHub Pages (CI/CD)

`.github/workflows/deploy.yml` type-checks and builds every push and pull request to `main`, and deploys pushes to `main` to GitHub Pages.

1. In the GitHub repo, open **Settings > Pages** and set **Source** to **GitHub Actions**.
2. Push to `main`. The site is published at `https://<user>.github.io/<repo>/`.
3. In Firebase Console, open **Authentication > Settings > Authorized domains** and add `<user>.github.io` so Google sign-in works.

Optional repository variables (**Settings > Secrets and variables > Actions > Variables**):

- `VITE_WHATSAPP_NUMBER`: WhatsApp Business number, e.g. `919000000000`.
- `VITE_BASE_PATH`: set to `/` when using a custom domain.

GitHub Pages is static hosting, so the Express API in `server.ts` does not run there. Payments run in Test Mode and order emails are queued in Firestore. For live Razorpay or SMTP, host `server.ts` separately, for example on Cloud Run.
