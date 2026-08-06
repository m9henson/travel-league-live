# Ozark Travel Stein League v14

## Changes
- Handicap-skin ties count as winners for every tied player.
- Blind-skin ties count as winners for every tied player.
- The Skins tab lists every tied winner and credits one skin to each.
- Admin-only **Clear All Scores** deletes score entries without deleting the tournament, course, players, groups, handicaps, secure links, or selected skin holes.
- Includes the secure group-link permissions from v11.

## Install
Upload every file in this folder to the GitHub Pages repository root. Then publish the included `firestore.rules` in Firebase Console under Firestore Database → Rules.


## Clean upload
Delete the old website files in the GitHub Pages publishing folder, then upload every file in this ZIP directly to that same folder. Do not upload the ZIP itself or place the files inside an extra folder.

The Firebase configuration is already included in `firebase-config.js` using the variable name required by the app.

After GitHub Pages finishes deploying, open `https://m9henson.github.io/?v=14` and confirm the badge says **v14**.
