# OpenGym iPhone app (Apple Health)

A tiny native shell, built with [xtool](https://github.com/xtool-org/xtool), that opens the live site
(https://opengym-alpha-seven.vercel.app) and saves every finished workout to Apple Health as a
Strength Training workout, so it shows in the Fitness app next to your Apple Watch data.

## Install on a Mac (one time)

1. Install **Xcode** from the App Store and open it once.
2. `brew install xtool-org/tap/xtool`
3. `xtool setup` and pick **Password** to sign in with your Apple ID.
4. Plug the iPhone in with a cable, tap **Trust**, and turn on
   Settings › Privacy & Security › **Developer Mode** (the phone restarts).
5. From this folder: `xtool dev`

The first time you finish a workout, iOS asks for permission to write workouts to Health. Allow it.

With a free Apple ID the app stops opening after 7 days; plug in and run `xtool dev` again to renew.
Sign-in inside this app is separate from the Home Screen app, so log in once with your email and password.
