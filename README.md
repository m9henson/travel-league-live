# Travel League Live v3

Mobile-first live golf scoring for:

- Individual gross stroke play
- Individual net stroke play using course handicaps

This version uses the Firestore REST API directly and does not depend on Firebase JavaScript modules. It also removes the old service-worker cache that could leave the site on a blank screen.

## Replace the GitHub Pages files

Upload every file in this folder to the root of the existing `travel-league-live` repository and replace the old files.

Important files:

- `index.html`
- `app.js`
- `styles.css`
- `firebase-config.js`
- `service-worker.js`
- `manifest.webmanifest`
- `firestore.rules`

After GitHub Pages finishes deploying, open:

`https://m9henson.github.io/travel-league-live/?v=3`

The page header must show a small `v3` badge.

## Firestore Security Rules

Firebase test-mode rules expire. In Firebase Console, open:

**Build → Firestore Database → Rules**

Replace the rules with the contents of `firestore.rules`, then click **Publish**.

These simple rules allow anyone with the website link to read tournaments and enter scores. Add Firebase Authentication later for admin-only control.

## Scoring

For gross events, the leaderboard uses gross score relative to par.

For net events:

1. Enter each golfer's **course handicap for that event**.
2. Select the handicap allowance, such as 100% or 95%.
3. Verify each hole's stroke index.
4. The app distributes handicap strokes by stroke index and ranks players by net score relative to par.

## Testing without Firebase

Open the site with `?demo=1` at the end of the URL to use a local demo database:

`https://m9henson.github.io/travel-league-live/?demo=1`
