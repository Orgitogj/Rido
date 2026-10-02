# Manual test checklist

Automated tests use in-memory stand-ins for every external service. This checklist is the verification that still has to be done by hand, with real test-mode credentials and real devices. Nothing here has been run as part of the implementation work.

## Before you start

- Two physical phones (or one phone and one emulator with a mock location) with a **development build**; Expo Go cannot do background location or Android push.
- A desktop browser for the operator console.
- An isolated database with all migrations applied (`npm run db:setup`). Do not use a shared database for destructive steps.
- Clerk development instance, Stripe **test** keys and a webhook endpoint (or `stripe listen`), a Google Cloud key restricted to the Routes API, a Places key for address search, a private S3-compatible bucket.
- One operator granted from the CLI with `view,support,refund,verify,configure`.
- An active service area with a fare policy that covers where the two phones are.
- `GET /api/ready` returns `200`, and the console's **System** page shows no "Missing" line.

Record the build, date, device models and OS versions with the results.

## 1. Accounts (Clerk)

- [ ] Sign up with email and password; the verification code arrives; the app opens on Home.
- [ ] Sign out, sign in again.
- [ ] Reset the password from the sign-in screen; the old password stops working.
- [ ] Change the display name in Profile; it appears on the next ride for the driver.
- [ ] Change the email in Profile; the code goes to the new address; the new address signs in.
- [ ] Change the password in Profile.
- [ ] Switch the language to Albanian on the welcome screen and in Profile; restart the app; the choice is kept.

## 2. Saved places and address search (Google Places)

- [ ] Search an address in English and in Albanian.
- [ ] Save Home, Work and a custom place; edit the custom name; delete it.
- [ ] Pick a saved place as destination from Home, and as pickup on the next screen.
- [ ] Save a place outside every service area and try to book from it: the booking screen explains that the saved place is outside coverage and the place stays saved.
- [ ] Sign in as a second user on the same phone: the first user's places are not shown.

## 3. Booking and payment (Stripe test mode)

- [ ] Get a price; the confirmation shows price, distance, time and how long the price is held.
- [ ] Wait for the price to expire on the confirmation screen: the request button is replaced by an expiry notice; getting a new price shows whether it changed.
- [ ] Pay with `4242 4242 4242 4242`: the ride starts searching; Stripe shows an uncaptured PaymentIntent.
- [ ] Pay with a 3-D Secure test card and complete the challenge.
- [ ] Pay with a declined test card: no ride is created in searching state, and the message says nothing was charged.
- [ ] Close the app during the search and reopen: Home shows the ride in progress and opens it.

## 4. Two-device ride

Passenger on phone A, approved driver on phone B.

- [ ] Driver goes online; passenger requests; the offer appears on B with a countdown.
- [ ] Accept: A shows the driver, vehicle, plate and a live position with its age.
- [ ] Driver taps through to pickup, arrived, start, complete; A follows within about a second.
- [ ] "Navigate to pickup" opens the maps app before pickup and "Navigate to destination" after the trip starts.
- [ ] Chat in both directions; unread counts; the Messages tab shows the conversation for the current ride.
- [ ] Complete: Stripe shows the capture; A sees the receipt; both can rate; A can tip.
- [ ] Repeat with the driver cancelling before pickup: A is re-matched or told no driver was found, with the hold kept or released as the screen says.
- [ ] Repeat with the passenger cancelling: the confirmation states that there is no fee and the hold is released; Stripe shows the cancellation.
- [ ] Driver ends a trip early with a reason: A is not charged and the ride is in the operator review queue.

## 5. Quotes and matching (Google Routes)

- [ ] The quoted distance matches a maps app for the same route within reason.
- [ ] Pickup outside every area, and destination outside the allowed area, are refused with a clear message and no route request (check the Google Cloud console).
- [ ] With two drivers online, the one with the shorter road time gets the offer.
- [ ] Remove the key and restart: quotes are refused; nothing is priced by straight line.

## 6. Driver documents (storage bucket)

- [ ] Upload a JPEG, a PNG and a PDF; each appears as waiting for review.
- [ ] Try a file over 10 MB and a renamed non-image: both are refused.
- [ ] The operator opens each file from the console; the link stops working after a minute.
- [ ] Confirm in the provider's console that the bucket is private and that no public URL serves a document.
- [ ] Replace a document; the old file is deleted after its retention.

## 7. Operator console

- [ ] `/admin` on a phone build shows only the "available in a web browser" notice.
- [ ] A signed-in non-operator sees "No operator access".
- [ ] Queue badges match the queues and update after an action.
- [ ] Support: assign to yourself, reply (the passenger gets an inbox item and a push), add an internal note (the passenger never sees it), resolve, reopen.
- [ ] The passenger sees the status and the conversation under Help and support, and can reply while the request is open.
- [ ] Refund part of a fare in test mode; the receipt and the driver's earnings reflect it after Stripe confirms.
- [ ] Approve, request changes on, and suspend a driver; the driver gets an inbox item each time.
- [ ] System page: stop the scheduler and confirm the last sweep time stops advancing.

## 8. Notifications and inbox (Expo push, development build)

- [ ] A push arrives for: offer (driver), accepted, arrived, started, completed, cancelled, support reply, driver application decision.
- [ ] Tapping each opens the right screen; a push for another account is ignored.
- [ ] Every item is also in the inbox; opening it marks it read; "mark all read" clears the Home badge.
- [ ] Switch a category off: no push for it, but the item is still in the inbox.
- [ ] Deny notification permission: the inbox explains that push is off and still lists items.
- [ ] Push text follows the account's language.

## 9. Location (GPS)

- [ ] Deny location as a driver: going online explains why it is needed.
- [ ] Allow, go online, lock the phone with background sharing on: the passenger keeps seeing movement.
- [ ] Turn on airplane mode on the driver's phone: the passenger sees the position age grow, then "unavailable"; the driver's screen says the position is not reaching the server.
- [ ] Force-quit the driver's app during a ride: sharing stops; reopening resumes it.
- [ ] Drive a short real route and compare the ETA with a maps app.

## 10. Account switching and deletion

- [ ] Sign out and sign in as another user on the same phone: no rides, places, inbox items or driver state from the first user are visible, and pushes for the first user are not shown.
- [ ] Delete account with a ride in progress, while online as a driver, and as an operator: each is refused with its reason.
- [ ] Delete account: the password is asked again; after confirming, the app returns to the welcome screen.
- [ ] The Clerk user and the Stripe test customer are gone.
- [ ] Signing in with the same credentials is refused.
- [ ] As an operator, the deleted passenger's past rides show no name; the receipt amounts and audit history are still there.
- [ ] Remove `CLERK_SECRET_KEY`, delete another account: the app says the sign-in removal is still finishing; restore the key and run the sweep: it completes.

## 11. Accessibility and layout

- [ ] TalkBack and VoiceOver read every button, the ride status changes, and error messages.
- [ ] With the largest system text size, no button label is cut off on Home, booking, the ride screen and the driver screen.
- [ ] Every tappable control is comfortably tappable; star rating and tip chips included.
- [ ] Albanian strings fit on a small phone.
- [ ] Colour is never the only signal for an error or a status.

## 12. Public share link

- [ ] Create a link during a ride and open it in a browser without signing in.
- [ ] It shows the status, driver first name, vehicle, plate and destination, and no payment or chat data.
- [ ] Stop sharing: the link stops working at once.
