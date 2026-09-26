# App Review Notes

## Login

The app supports email verification-code login and account creation when enabled by the production server. The login screen reads currently allowed email domains and available login methods from server configuration. Before submission, verify the reviewer can receive a code using an allowed address and has sufficient credits for the review paths; starter credits depend on the current registration configuration and must not be assumed.

## Main review paths

- Text-to-image: Home > Text to Image.
- AI assistant: bottom navigation > AI.
- Account deletion: Me > Account & Security > Delete Account. A fresh email verification code and final confirmation are required.
- Data export: Me > Account & Security > Export Account Data.
- Privacy policy: Login screen, or Me > About > Privacy Policy.
- Community safety: open another user's community post to report the post or block its author.

## Commerce

Version 1.0 does not expose package prices, purchase actions, external payment links, payment QR codes, or redemption-code entry points. Existing account balances, promotional activity benefits, subscription status and historical order records remain readable.

## Backend

All production APIs and generated-file downloads must remain reachable at `https://starcloudisai.com` for the full review period.
