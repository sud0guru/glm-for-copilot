# Changelog

All notable changes to GLM Models for GitHub Copilot Chat are documented here.

## Unreleased

### Fixed

- **Usage panel** - the Reset Quota card now renders below the metrics grid instead of spanning it, which left a dead empty column beside the 5-hour and weekly limit cards on panels wider than ~865px.

## 0.1.0

Initial release.

- **GLM models in GitHub Copilot Chat** - use Z.ai / Zhipu GLM models with your own API key in both Coding Plan and Standard API modes, on the International (`z.ai`) and Mainland China (`bigmodel.cn`) regions.
- **Reasoning models with visible thinking** - GLM-5.3 (default), GLM-5.3-Flash, GLM-5.3-FlashX, GLM-5.2, GLM-5, and GLM-4.7 with Low / High / Max thinking effort streamed into the chat's thinking block.
- **Native image input** - attach PNG/JPEG images to multimodal models (GLM-5.3-Flash / FlashX); text-only models fall back to automatic image analysis on the same endpoint and key.
- **Usage tracking** - a status-bar quota indicator plus a usage panel with z.ai-style 5-hour and weekly limit cards, credit-limit quotas, reset countdowns, and Standard API balance with token packages.
- **Reset Quota redemption** - redeem banked 5-hour or weekly reset cards from the usage panel or the Command Palette, each with a confirmation step.
- **Activity panel** - cumulative and peak tokens, usage duration, current and longest streak, and a GitHub-style 365-day heatmap with daily / weekly / cumulative modes.
- **Key management and diagnostics** - commands to set, inspect, and clear the API key (stored in VS Code SecretStorage), retry with backoff, business-error reporting, and a dedicated GLM output log.
- **English and Simplified Chinese UI** - fully localized command titles, settings, and panels.
