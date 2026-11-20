# CAEDM Software Hub email delivery: IT handoff

## Confirmed rejection

One approved test from `noreply@caedm.ca` to `ruban.peppin@caedm.ca` was accepted by Resend and subsequently bounced. No password reset or employee account change was part of this test.

- Subject: **TEST — Software Hub email delivery check**
- Resend acceptance time: **2026-11-20 17:37:42 UTC** (**11:37:42 AM GMT-6**)
- Resend message ID: `01a1fa09-17c9-7a4f-82d7-cac653a3aa74` (provider reference; ask Resend for the SMTP Message-ID if needed)
- SMTP diagnostic supplied from the bounce details: `smtp; 550 5.7.1 Sender ID (PRA) Not Permitted`

This establishes downstream rejection after API acceptance. It does not identify the specific receiving gateway or actual sending IP; IT/Resend must obtain those from the message trace.

A second user-requested test, **TEST — Software Hub email delivery recheck**, was accepted at **2026-11-20 20:24:19 UTC** (**2:24:19 PM GMT-6**) with Resend reference `01a1faa1-a407-72f0-b8c0-deb3d6bccf10`. Its API delivery status was also `bounced`. The second message's SMTP diagnostic was not supplied, so the PRA diagnostic above remains confirmed for the first test only.

## Observations, November 20, 2026

Resend reports `caedm.ca` verified, with verified sending records:

| Name | Type | Target |
| --- | --- | --- |
| `send.caedm.ca` | CNAME | `send.forge.rmta.net` |
| `rsend.caedm.ca` | CNAME | `rsend.forge.rmta.net` |

Public DNS returned this main-domain SPF policy:

```text
v=spf1 mx ptr ip4:64.141.20.64/27 mx:mail.caedm.ca mx:mail2.caedm.ca include:newman.edu include:olvc.ab.ca include:stjoseph-seminary.com include:stjosephbasilica.com include:servers.mcsv.net include:sendgrid.net include:outboundmail.blackbaud.net -all
```

The `send.caedm.ca` policy resolved to:

```text
v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all
```

The two policies differ. A likely explanation is that a receiving gateway applies Sender ID/PRA checks to the visible `From: ...@caedm.ca` domain and does not authorize the actual Resend/Forge source. The bounce supports investigating this; only the gateway trace can confirm the evaluated PRA domain and IP. Verified subdomain SPF/DKIM alone does not prove compatibility with that receiving policy.

## Request to IT

Please trace this message at the CAEDM inbound gateway and identify the rejecting server, source IP, evaluated PRA domain, envelope sender, and SPF/DKIM/DMARC results. Confirm how legitimate Resend/Forge application mail using CAEDM From addresses should be authorized under the existing Sender ID policy.

Coordinate with Resend for its supported authorization mechanism for this Forge-enabled domain. Review the existing root SPF policy and DNS lookup budget before editing it; retain existing legitimate senders and a single SPF record at each name. Do not add guessed include domains or copy a transient sending IP as a permanent fix. Any gateway exception should be narrowly scoped to verified legitimate application mail, rather than disabling spoof protection globally.

After the correction, arrange one approved test and verify both Resend's delivery event and actual inbox receipt before retrying employee recovery. A later bounce cannot trigger the application's immediate SMTP fallback: Resend had already accepted the send. Automatic resending through a second transport after that acceptance risks duplicates.

Resend's suggestions to avoid `noreply` and match link domains are separate deliverability recommendations. Changing the local part alone does not authorize the sending IP for PRA. A future CAEDM application hostname needs its own DNS, Vercel domain/certificate and Auth URL configuration; keep all reset links pointed at the actual deployed application.

## Sources

- [Microsoft: Sender ID and sender-domain policy checks](https://learn.microsoft.com/en-us/exchange/antispam-and-antimalware/antispam-protection/sender-id)
- [Broadcom: the exact 550 5.7.1 PRA rejection](https://knowledge.broadcom.com/external/article/154549/messages-are-not-delivered-with-the-550.html)
- [Resend: Forge infrastructure and managed CNAME activation](https://resend.com/blog/announcing-resend-forge)

No DNS, production configuration or real employee credentials were changed while preparing this handoff.
