# Q STAY / Q RIDE — iOS apps (Expo + EAS)

Native shells around the Q STAY / Q RIDE web apps, built in the cloud with EAS (no Xcode needed),
the same way as the Millo app. `shared/WebShell.js` adds: offline screen, pull-to-refresh, links
outside the app's domain open in Safari, and (Q RIDE) native location permission.

Build and send to TestFlight, on the owner's Mac (signed in to Expo and Apple):
```
cd QC/ios/qstay && npm install && npx eas-cli build -p ios --profile production && npx eas-cli submit -p ios --latest
cd QC/ios/qride && npm install && npx eas-cli build -p ios --profile production && npx eas-cli submit -p ios --latest
```
EAS manages the Apple signing certificate; nothing secret is stored in this repo.
Still to add before App Store review (Apple rule 4.2): Sign in with Apple, push notifications.
