# Security policy

## Reporting a vulnerability

Please don't open a public issue. Report it privately through
[GitHub's vulnerability reporting](https://github.com/robrich82/webextension-pixiv-toolkit/security/advisories/new).

Include the extension version, the browser, and the steps or proof of concept needed to reproduce it.
You'll get a reply once it has been triaged, and credit in the advisory unless you'd rather not.

## Supported versions

Only the latest release gets fixes.

## Scope

In scope: anything that lets a web page or another extension abuse this extension, for example
reading pixiv/fanbox session data, running script in the options page, using its permissions,
or writing downloads outside the chosen folder.

Out of scope: bugs in pixiv or fanbox themselves, and releases of the original
[leoding86/webextension-pixiv-toolkit](https://github.com/leoding86/webextension-pixiv-toolkit).
