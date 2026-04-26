# DSV2 Capacitor Setup

This package is ready for Capacitor wrapping.

## What is included
- `www/` web app source
- `capacitor.config.ts`
- GitHub Actions workflow to build Android APK

## Local steps
```bash
npm install
npx cap add android
npx cap sync android
npx cap open android
```

## GitHub Actions
Push this repo to GitHub and the workflow will:
- install Node.js
- install Capacitor packages
- add Android platform if missing
- sync web assets
- build APK

## Notes
- Data is stored locally in the device/browser using localStorage.
- The web app is in `www/`.
