# Security policy

ClassiCade is a live website, not a library, so there are no versions to support: only what runs in production
(https://nocapgaming.onrender.com, and the brand domain once it moves) and the latest `main` branch.

## Reporting a vulnerability

Please report privately through GitHub: this repository → **Security** → **Report a vulnerability**. Do not open a
public issue, pull request or discussion for a security problem, and do not share it elsewhere until it is fixed.

Include what you found, where (page, API route or socket event), steps to reproduce, and what an attacker could do.

## What to expect

- An acknowledgement within 3 days.
- An update within 7 days, saying whether we can reproduce it and how serious we think it is.
- For a serious issue, a fix or a decision within 30 days. We tell you when it is live.
- Credit in the fix's notes if you want it. There is no paid bounty.

## Rules for testing

Good-faith research within these rules is welcome, and we will not take action against it.

- Use only accounts you created. Never read, change or delete another player's data; if you reach any by accident,
  stop and tell us.
- Players may be children. Do not contact other players or collect anything about them.
- No denial of service, flooding, spam or automated attacks that slow the site for others.
- No social engineering, phishing or physical attacks.
- Do not test the services we run on (Render, MongoDB Atlas, GitHub): report problems in them to their owners.

## In scope

The website and everything it serves: pages, `/api/*` routes, the realtime (Socket.IO) connection and the owner
console. The code in this repository.

## Out of scope

Findings that need a compromised device or browser, missing headers with no real impact, rate limits that are
working as designed, and reports from automated scanners with no proof of impact.

Privacy questions that are not vulnerabilities go through the contact on the site's privacy page.
