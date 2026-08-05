# Travel League Live v11

Fixes private group links that could fail with "Missing or insufficient permissions" when reopened or restored by Safari.

## Deploy
1. Replace all website files in the GitHub Pages repository root.
2. Copy `firestore.rules` into Firebase Console > Firestore Database > Rules and publish.
3. Open the administrator site.
4. Regenerate all secure links and resend the new links.
5. Test a group link in a Private Browsing tab.

Old group links should not be reused.
