# Security policy

## Supported versions

Security fixes are applied to the latest published release. Until 1.0.0 is published, report issues against the local release candidate privately.

## Reporting a vulnerability

Do not open a public issue containing a developer key, private TestLink URL, XML response, user data, or attachment. Use GitHub private vulnerability reporting after the public repository is created.

Rotate any credential that may have appeared in logs before sharing diagnostics. Include only redacted reproduction steps and synthetic data.

## Security properties

- TLS verification is never disabled.
- Developer keys are redacted from caught errors and ledger records.
- XML response size and request duration are bounded.
- Attachments return metadata only.
- Writes default to off and require preview, confirmation, snapshot revalidation, and a ledger record.
- Delete operations are not exposed.
- Side effects are not automatically retried.
