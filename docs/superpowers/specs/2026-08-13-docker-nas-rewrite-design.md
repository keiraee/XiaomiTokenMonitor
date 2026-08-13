# Docker NAS Rewrite Design

Date: 2026-08-13

## Goal

Rewrite XiaomiTokenMonitor as a single Docker service for home NAS / LAN hosts.
Drop Windows-only pieces. Keep QR login + SSO refresh + usage query.

## Decisions

- Target: home NAS / small host, LAN access
- Auth: Xiaomi QR login only (no password / SMS / panel password)
- Alerts: none (status only in web UI)
- Shape: single Node container (Approach A)
- Port: default `9990`, bind `0.0.0.0`
- Persistence: volume mount `./data:/data` for cookies / meta / logs
- Code: structural rewrite, reuse SSO / cookie / QR logic

## Architecture

```text
Browser (LAN) → http://nas:9990
  → Node container
     ├─ static Vue UI (QR login + dashboard)
     ├─ API (QR / status / usage / refresh / logout)
     └─ background serviceToken refresh
  → /data volume
     ├─ cookies.json
     ├─ meta.json
     └─ server.log
```

## Out of scope

- Windows `msg` notifications
- Playwright browser / headless login
- Password / SMS login
- install.ps1 / scheduled task installer
- reverse proxy / HTTPS (LAN IP first)
