# Privacy policy

maintab has no backend. There is no maintab server, no analytics, and no third party in the request path.

## What is stored

Everything maintab keeps lives in your browser's extension storage on your own device:

- The GitHub personal access token you enter, in plain text. It is not encrypted at rest, the same as any other extension that stores a token.
- A cached copy of the data shown on the dashboard: your open pull request titles and numbers, notification subjects, Dependabot alert package names and severities, and star counts.
- Star history you accumulate over time, at most one data point per repo per hour, pruned after 90 days.
- Your settings: poll interval, theme, tracked repos, and ignore lists.

## What is sent, and where

maintab talks to `api.github.com` and nowhere else. Requests carry your token in an authorization header so GitHub can return your data. The extension requests access to that one host in its manifest and cannot reach any other.

Marking a notification as read sends a request to GitHub to mark that thread read. No other action writes anything to your account.

## What is not done

maintab does not collect telemetry, does not report usage, does not contain advertising or tracking code, and does not execute remote code. Nothing is sent to the author of this extension.

## Removing your data

Uninstalling the extension removes everything it stored. You can also clear the token from the settings panel at any time, or revoke it at https://github.com/settings/tokens, which stops the extension from reading anything.

## Questions

Open an issue at https://github.com/connorgallopo/maintab/issues.
