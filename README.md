# Travel League Live v2

Mobile-first live golf scoring for GitHub Pages and Firebase Firestore.

## Features
- Gross scoring or handicap/net scoring per tournament
- 9- or 18-hole events
- Course handicap and adjustable handicap allowance
- Hole-by-hole par and stroke-index setup
- Live leaderboard across phones
- Fast score entry, corrections, and shareable tournament links

## Update an existing GitHub Pages site
1. Extract this ZIP.
2. In the existing GitHub repository, upload and replace `index.html`, `app.js`, `styles.css`, and `service-worker.js`.
3. Keep your current `firebase-config.js` if it already contains your Firebase config. If it is blank, the Firebase config previously saved in the browser will still work.
4. Commit the files and wait one or two minutes for GitHub Pages.
5. On iPhone, reload the page. If the old version remains, close the tab and reopen it, or clear Safari website data for the site.

## Firestore rules
For initial private testing, deploy the included `firestore.rules`. They allow public read/write access. Before broad public use, add Firebase Authentication and tighter rules.

## Handicap method
Enter each player's **course handicap**. The app applies the selected allowance, rounds to a playing handicap, then distributes strokes using each hole's stroke index. For a 9-hole event, enter the appropriate 9-hole course handicap.
